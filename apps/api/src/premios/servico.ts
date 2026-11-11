/**
 * Serviço de prêmios: catálogo, detalhe, vales e resgate.
 *
 * Toda leitura é do usuário da SESSÃO (usuarioId vem do app.ts, nunca do
 * cliente). O motivo de bloqueio é calculado aqui, pelas mesmas regras que o
 * resgate confere de novo dentro da transação.
 */
import type {
  Bloqueio,
  Catalogo,
  Categoria,
  CodigoErro,
  DetalheResposta,
  FiltroVales,
  ListaVales,
  PremioDetalhe,
  PremioResumo,
  Vale,
} from "@ecoponto/contracts";
import { formatPontos } from "@ecoponto/format";
import {
  avaliarBloqueio,
  estoqueBaixo,
  gerarCodigoVale,
  inicioDoMes,
  prazoRetirada,
  statusEfetivo,
  venceEmBreve,
} from "@ecoponto/regras";
import { codigoPg, type Db, type Executor } from "../db/db.ts";
import { lancar, saldoDe } from "../ledger/ledger.ts";
import type { CacheCatalogo } from "./cache.ts";

export type OpcoesServico = {
  db: Db;
  cache: CacheCatalogo;
  agora: () => Date;
  /** [DEFINIR] Fase 3 (gamificação). Desligada: nível mínimo ignorado. */
  gamificacaoAtiva: boolean;
  bytesAleatorios?: (n: number) => Uint8Array;
};

/** Linha de `premios` como guardada no cache (datas em ISO, para caber no Redis). */
type PremioLinha = {
  id: string;
  nome: string;
  descricao: string;
  fotoUrl: string;
  categoria: Categoria;
  custo: number;
  estoque: number;
  limitePorMes: number | null;
  nivelMinimo: number | null;
  ofertaAte: string | null;
  ativo: boolean;
  ondeRetirar: string;
};

type Cidadao = { id: string; ref: string; perfil: "cidadao" | "catador"; nivel: number };

/** Falha de regra no resgate: desfaz a transação e vira resposta 4xx. */
export class FalhaResgate extends Error {
  constructor(
    readonly codigo: CodigoErro,
    readonly bloqueio: Bloqueio | null = null,
  ) {
    super(codigo);
  }
}

export type ResultadoResgate =
  | { ok: true; vale: Vale; saldo: number; repetido: boolean }
  | { ok: false; erro: CodigoErro; bloqueio: Bloqueio | null };

const SQL_PREMIO = `
  SELECT id, nome, descricao, foto_url AS "fotoUrl", categoria, custo, estoque,
         limite_por_mes AS "limitePorMes", nivel_minimo AS "nivelMinimo",
         oferta_ate AS "ofertaAte", ativo, onde_retirar AS "ondeRetirar"
    FROM premios`;

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === "string" ? new Date(d).toISOString() : null);

function linhaPremio(r: Record<string, unknown>): PremioLinha {
  return { ...(r as PremioLinha), ofertaAte: iso(r.ofertaAte) };
}

const CHAVE_CATALOGO = "catalogo:ativos";

export function criarServico(o: OpcoesServico) {
  const { db, cache, agora } = o;
  const aleatorio = o.bytesAleatorios ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));

  async function cidadao(ex: Executor, usuarioId: string): Promise<Cidadao | null> {
    const { rows } = await ex.query<Cidadao>("SELECT id, ref, perfil, nivel FROM cidadaos WHERE id = $1", [usuarioId]);
    return rows[0] ?? null;
  }

  /** Vales do mês (Boa Vista) por prêmio, sem os cancelados. */
  async function resgatesNoMes(ex: Executor, usuarioId: string, premioId?: string): Promise<Map<string, number>> {
    const params: unknown[] = [usuarioId, inicioDoMes(agora())];
    if (premioId) params.push(premioId);
    const { rows } = await ex.query<{ premio_id: string; n: number }>(
      `SELECT premio_id, count(*)::int AS n FROM vales
        WHERE usuario_id = $1 AND resgatado_em >= $2 AND status <> 'cancelado'
        ${premioId ? "AND premio_id = $3" : ""}
        GROUP BY premio_id`,
      params,
    );
    return new Map(rows.map((r) => [r.premio_id, r.n]));
  }

  const premiosAtivos = () =>
    cache.obter(CHAVE_CATALOGO, async () => {
      const { rows } = await db.query(`${SQL_PREMIO} WHERE ativo ORDER BY custo, nome`);
      return rows.map(linhaPremio);
    });

  function bloqueioDe(p: PremioLinha, c: Cidadao, saldo: number, noMes: number): Bloqueio | null {
    return avaliarBloqueio(
      {
        ativo: p.ativo,
        custo: p.custo,
        estoque: p.estoque,
        ofertaAte: p.ofertaAte ? new Date(p.ofertaAte) : null,
        nivelMinimo: p.nivelMinimo,
        limitePorMes: p.limitePorMes,
      },
      { saldo, nivel: c.nivel, resgatesNoMes: noMes },
      { agora: agora(), gamificacaoAtiva: o.gamificacaoAtiva },
    );
  }

  function resumo(p: PremioLinha, bloqueio: Bloqueio | null): PremioResumo {
    return {
      id: p.id,
      nome: p.nome,
      fotoUrl: p.fotoUrl,
      categoria: p.categoria,
      custo: p.custo,
      estoque: p.estoque,
      estoqueBaixo: estoqueBaixo(p.estoque),
      bloqueio,
    };
  }

  function detalhe(p: PremioLinha, bloqueio: Bloqueio | null): PremioDetalhe {
    return {
      ...resumo(p, bloqueio),
      descricao: p.descricao,
      ofertaAte: p.ofertaAte,
      ondeRetirar: p.ondeRetirar,
      limitePorMes: p.limitePorMes,
      nivelMinimo: o.gamificacaoAtiva ? p.nivelMinimo : null,
      retirarAteSeTrocarAgora: prazoRetirada(agora()).toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Vales
  // -------------------------------------------------------------------------

  const SQL_VALE = `
    SELECT v.id, v.codigo, v.custo, v.status, v.resgatado_em, v.retirar_ate,
           v.retirado_em, v.retirado_ecoponto, v.cancelado_em,
           p.id AS premio_id, p.nome AS premio_nome, p.foto_url AS premio_foto,
           e.ocorrido_em AS estornado_em, e.pontos AS estornado_pontos
      FROM vales v
      JOIN premios p ON p.id = v.premio_id
      LEFT JOIN lancamentos e ON e.vale_id = v.id AND e.tipo = 'estorno'`;

  type ValeLinha = {
    id: string;
    codigo: string;
    custo: number;
    status: "disponivel" | "retirado" | "cancelado";
    resgatado_em: Date;
    retirar_ate: Date;
    retirado_em: Date | null;
    retirado_ecoponto: string | null;
    cancelado_em: Date | null;
    premio_id: string;
    premio_nome: string;
    premio_foto: string;
    estornado_em: Date | null;
    estornado_pontos: number | null;
  };

  function montarVale(r: ValeLinha): Vale {
    const agoraD = agora();
    const retirarAte = new Date(r.retirar_ate);
    const status = statusEfetivo(r.status, retirarAte, agoraD);
    const historico: Vale["historico"] = [
      {
        evento: "resgatado",
        em: new Date(r.resgatado_em).toISOString(),
        texto: `Troca feita por ${formatPontos(r.custo)}`,
      },
    ];
    if (r.status === "retirado" && r.retirado_em) {
      historico.push({
        evento: "retirado",
        em: new Date(r.retirado_em).toISOString(),
        texto: `Retirado no ${r.retirado_ecoponto ?? "ecoponto"}`,
      });
    }
    if (r.status === "cancelado" && r.cancelado_em) {
      historico.push({ evento: "cancelado", em: new Date(r.cancelado_em).toISOString(), texto: "Cancelado pela gestão do programa" });
    }
    if (r.estornado_em && r.estornado_pontos) {
      historico.push({
        evento: "estornado",
        em: new Date(r.estornado_em).toISOString(),
        texto: `${formatPontos(r.estornado_pontos)} voltaram para o seu saldo`,
      });
    }
    if (status === "vencido") {
      historico.push({ evento: "vencido", em: retirarAte.toISOString(), texto: "Prazo de retirada encerrado" });
    }
    return {
      codigo: r.codigo,
      premio: { id: r.premio_id, nome: r.premio_nome, fotoUrl: r.premio_foto },
      custo: r.custo,
      resgatadoEm: new Date(r.resgatado_em).toISOString(),
      retirarAte: retirarAte.toISOString(),
      status,
      venceEmBreve: venceEmBreve(status, retirarAte, agoraD),
      retirada:
        status === "retirado" && r.retirado_em
          ? { em: new Date(r.retirado_em).toISOString(), ecoponto: r.retirado_ecoponto ?? "ecoponto" }
          : null,
      cancelamento: status === "cancelado" && r.cancelado_em ? { em: new Date(r.cancelado_em).toISOString() } : null,
      historico,
    };
  }

  async function valePorId(ex: Executor, valeId: string): Promise<Vale> {
    const { rows } = await ex.query<ValeLinha>(`${SQL_VALE} WHERE v.id = $1`, [valeId]);
    if (!rows[0]) throw new Error("Vale não encontrado após o resgate");
    return montarVale(rows[0]);
  }

  // -------------------------------------------------------------------------
  // Resgate (T26)
  // -------------------------------------------------------------------------

  /**
   * Uma única transação, READ COMMITTED, travando linhas sempre na mesma
   * ordem (chave de idempotência → saldo do cidadão → prêmio), para não haver
   * deadlock:
   *
   *  1. Registra a Idempotency-Key. Se outro pedido com a mesma chave está em
   *     andamento, este ESPERA no índice único; quando o outro termina, ou
   *     devolvemos o vale dele (repetido) ou seguimos (se ele falhou).
   *  2. SELECT … FROM saldos FOR UPDATE: pedidos do mesmo cidadão entram em fila.
   *  3. SELECT … FROM premios FOR UPDATE: pedidos pelo mesmo prêmio entram em fila.
   *  4. Confere TODAS as regras de novo (avaliarBloqueio).
   *  5. Baixa o estoque, cria o vale, lança o débito no livro-razão.
   *
   * Qualquer falha lança erro → ROLLBACK → nada é gravado.
   * Os CHECK (estoque >= 0, saldo >= 0) são a última defesa.
   */
  async function resgatar(usuarioId: string, premioId: string, chave: string): Promise<ResultadoResgate> {
    try {
      const r = await db.transacao(async (tx) => {
        const agoraD = agora();
        const c = await cidadao(tx, usuarioId);
        if (!c) throw new FalhaResgate("nao_autenticado");
        if (c.perfil !== "cidadao") throw new FalhaResgate("perfil_sem_premios");

        // 1. Idempotência
        const ins = await tx.query(
          `INSERT INTO resgate_idempotencia (usuario_id, chave, premio_id, criado_em)
           VALUES ($1, $2, $3, $4) ON CONFLICT (usuario_id, chave) DO NOTHING RETURNING chave`,
          [usuarioId, chave, premioId, agoraD],
        );
        if (ins.rows.length === 0) {
          const { rows } = await tx.query<{ premio_id: string; vale_id: string | null }>(
            "SELECT premio_id, vale_id FROM resgate_idempotencia WHERE usuario_id = $1 AND chave = $2",
            [usuarioId, chave],
          );
          const ja = rows[0];
          if (!ja?.vale_id) throw new Error("Chave de idempotência sem vale");
          if (ja.premio_id !== premioId) throw new FalhaResgate("idempotency_key_reutilizada");
          return { vale: await valePorId(tx, ja.vale_id), saldo: await saldoDe(tx, usuarioId), repetido: true };
        }

        // 2. Saldo do cidadão (trava)
        await tx.query("INSERT INTO saldos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING", [usuarioId]);
        const s = await tx.query<{ pontos: number }>("SELECT pontos FROM saldos WHERE usuario_id = $1 FOR UPDATE", [usuarioId]);
        const saldo = s.rows[0]?.pontos ?? 0;

        // 3. Prêmio (trava)
        const p = await tx.query(`${SQL_PREMIO} WHERE id = $1 FOR UPDATE`, [premioId]);
        if (!p.rows[0]) throw new FalhaResgate("premio_nao_encontrado");
        const premio = linhaPremio(p.rows[0]);

        // 4. Regras, de novo
        const noMes = (await resgatesNoMes(tx, usuarioId, premioId)).get(premioId) ?? 0;
        const bloqueio = bloqueioDe(premio, c, saldo, noMes);
        if (bloqueio) throw new FalhaResgate(bloqueio.codigo, bloqueio);

        // 5. Estoque, vale, débito
        const e = await tx.query("UPDATE premios SET estoque = estoque - 1 WHERE id = $1 AND estoque > 0 RETURNING estoque", [premioId]);
        if (e.rows.length === 0) throw new FalhaResgate("esgotado");

        const valeId = crypto.randomUUID();
        const retirarAte = prazoRetirada(agoraD);
        let criado = false;
        for (let tentativa = 0; tentativa < 5 && !criado; tentativa++) {
          const v = await tx.query(
            `INSERT INTO vales (id, codigo, usuario_id, premio_id, custo, status, resgatado_em, retirar_ate)
             VALUES ($1, $2, $3, $4, $5, 'disponivel', $6, $7)
             ON CONFLICT (codigo) DO NOTHING RETURNING id`,
            [valeId, gerarCodigoVale(aleatorio), usuarioId, premioId, premio.custo, agoraD, retirarAte],
          );
          criado = v.rows.length > 0;
        }
        if (!criado) throw new Error("Não foi possível gerar um código de vale único");

        const saldoNovo = await lancar(tx, {
          usuarioId,
          tipo: "resgate",
          pontos: premio.custo,
          descricao: `Troca: ${premio.nome}`,
          em: agoraD,
          valeId,
        });

        await tx.query("UPDATE resgate_idempotencia SET vale_id = $3 WHERE usuario_id = $1 AND chave = $2", [usuarioId, chave, valeId]);
        return { vale: await valePorId(tx, valeId), saldo: saldoNovo, repetido: false };
      });
      if (!r.repetido) await cache.apagar(CHAVE_CATALOGO);
      return { ok: true, ...r };
    } catch (e) {
      if (e instanceof FalhaResgate) return { ok: false, erro: e.codigo, bloqueio: e.bloqueio };
      // Última defesa do banco: os CHECK não deixam estoque nem saldo negativos.
      const sqlState = codigoPg(e);
      const restricao = e && typeof e === "object" && "constraint" in e ? String(e.constraint) : "";
      if (sqlState === "23514" && restricao === "estoque_nao_negativo") return { ok: false, erro: "esgotado", bloqueio: null };
      if (sqlState === "23514" && restricao === "saldo_nao_negativo") return { ok: false, erro: "saldo_insuficiente", bloqueio: null };
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Leituras
  // -------------------------------------------------------------------------

  return {
    resgatar,

    async perfil(usuarioId: string) {
      return (await cidadao(db, usuarioId))?.perfil ?? null;
    },

    async catalogo(usuarioId: string, filtro: { categoria?: Categoria | undefined; disponiveis?: boolean | undefined }): Promise<Catalogo | null> {
      const c = await cidadao(db, usuarioId);
      if (!c) return null;
      const cab = { usuarioRef: c.ref, atualizadoEm: agora().toISOString() };
      if (c.perfil === "catador") return { perfil: "catador", ...cab };
      const [premios, saldo, noMes] = await Promise.all([premiosAtivos(), saldoDe(db, usuarioId), resgatesNoMes(db, usuarioId)]);
      let lista = premios.map((p) => resumo(p, bloqueioDe(p, c, saldo, noMes.get(p.id) ?? 0)));
      if (filtro.categoria) lista = lista.filter((p) => p.categoria === filtro.categoria);
      if (filtro.disponiveis) lista = lista.filter((p) => p.bloqueio === null);
      return { perfil: "cidadao", ...cab, saldo, premios: lista };
    },

    /** Detalhe sempre do banco (estoque atual), sem cache. */
    async detalhe(usuarioId: string, premioId: string): Promise<DetalheResposta | "catador" | null> {
      const c = await cidadao(db, usuarioId);
      if (!c) return null;
      if (c.perfil === "catador") return "catador";
      const { rows } = await db.query(`${SQL_PREMIO} WHERE id = $1 AND ativo`, [premioId]);
      if (!rows[0]) return null;
      const p = linhaPremio(rows[0]);
      const [saldo, noMes] = await Promise.all([saldoDe(db, usuarioId), resgatesNoMes(db, usuarioId, premioId)]);
      return {
        perfil: "cidadao",
        usuarioRef: c.ref,
        atualizadoEm: agora().toISOString(),
        saldo,
        premio: detalhe(p, bloqueioDe(p, c, saldo, noMes.get(p.id) ?? 0)),
      };
    },

    async vales(usuarioId: string, filtro: FiltroVales): Promise<ListaVales | null> {
      const c = await cidadao(db, usuarioId);
      if (!c) return null;
      const cab = { usuarioRef: c.ref, atualizadoEm: agora().toISOString() };
      if (c.perfil === "catador") return { perfil: "catador", ...cab };
      const [{ rows }, saldo] = await Promise.all([
        db.query<ValeLinha>(`${SQL_VALE} WHERE v.usuario_id = $1 ORDER BY v.resgatado_em DESC`, [usuarioId]),
        saldoDe(db, usuarioId),
      ]);
      let vales = rows.map(montarVale);
      if (filtro === "disponiveis") vales = vales.filter((v) => v.status === "disponivel");
      return { perfil: "cidadao", ...cab, saldo, vales };
    },

    /** Só do próprio cidadão: vale de outra pessoa dá a mesma resposta que inexistente. */
    async vale(usuarioId: string, codigo: string): Promise<{ usuarioRef: string; atualizadoEm: string; vale: Vale } | null> {
      const c = await cidadao(db, usuarioId);
      if (!c) return null;
      const { rows } = await db.query<ValeLinha>(`${SQL_VALE} WHERE v.codigo = $1 AND v.usuario_id = $2`, [codigo, usuarioId]);
      if (!rows[0]) return null;
      return { usuarioRef: c.ref, atualizadoEm: agora().toISOString(), vale: montarVale(rows[0]) };
    },
  };
}

export type ServicoPremios = ReturnType<typeof criarServico>;
