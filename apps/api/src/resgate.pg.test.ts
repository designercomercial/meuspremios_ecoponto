/**
 * Transação do resgate contra um PostgreSQL DE VERDADE, com pedidos
 * realmente simultâneos (várias conexões do pool ao mesmo tempo).
 *
 * Critérios de aceite 1, 2 e 3.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db/db.ts";
import { migrar } from "./db/seed.ts";
import { lancar } from "./ledger/ledger.ts";
import { cacheEmMemoria } from "./premios/cache.ts";
import { criarServico, type ResultadoResgate } from "./premios/servico.ts";
import { bancoNovo } from "./test/pg.ts";

let db: Db;
let seq = 0;
const agora = () => new Date();
const chave = () => `chave-teste-${(++seq).toString().padStart(6, "0")}-${Math.random().toString(36).slice(2, 10)}`;

async function cidadao(saldo: number): Promise<string> {
  const id = `u-${++seq}`;
  await db.query("INSERT INTO cidadaos (id, ref, perfil, nivel) VALUES ($1, $2, 'cidadao', 1)", [id, `ref-${id}-xxxxxxxx`]);
  if (saldo > 0) await db.transacao((tx) => lancar(tx, { usuarioId: id, tipo: "entrega", pontos: saldo, descricao: "Entrega", em: agora() }));
  return id;
}

async function premio(p: { custo: number; estoque: number; limitePorMes?: number }): Promise<string> {
  const id = `prm_t${++seq}`;
  await db.query(
    `INSERT INTO premios (id, nome, descricao, foto_url, categoria, custo, estoque, limite_por_mes, ativo)
     VALUES ($1, 'Prêmio de teste', 'Descrição', '/f.svg', 'casa', $2, $3, $4, true)`,
    [id, p.custo, p.estoque, p.limitePorMes ?? null],
  );
  return id;
}

const um = async <T>(sql: string, params: unknown[]) => (await db.query<{ v: T }>(sql, params)).rows[0]?.v;
const saldo = (u: string) => um<number>("SELECT pontos AS v FROM saldos WHERE usuario_id = $1", [u]);
const somaLivro = (u: string) =>
  um<number>(
    "SELECT COALESCE(sum(CASE WHEN direcao = 'credito' THEN pontos ELSE -pontos END), 0)::int AS v FROM lancamentos WHERE usuario_id = $1",
    [u],
  );
const estoque = (p: string) => um<number>("SELECT estoque AS v FROM premios WHERE id = $1", [p]);
const contar = (tabela: string, onde: string, params: unknown[]) =>
  um<number>(`SELECT count(*)::int AS v FROM ${tabela} WHERE ${onde}`, params);

const erros = (rs: ResultadoResgate[]) => rs.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.erro));

beforeAll(async () => {
  db = await bancoNovo();
  await migrar(db);
});
afterAll(async () => {
  await db?.fechar();
});

const servico = (o: Partial<Parameters<typeof criarServico>[0]> = {}) =>
  criarServico({ db, cache: cacheEmMemoria(agora), agora, gamificacaoAtiva: true, ...o });

describe("concorrência no PostgreSQL", () => {
  it("critério 1: dois resgates simultâneos do último item → um sucesso e um Esgotado (20 rodadas)", async () => {
    const s = servico();
    for (let rodada = 0; rodada < 20; rodada++) {
      const p = await premio({ custo: 100, estoque: 1 });
      const [a, b] = [await cidadao(1000), await cidadao(1000)];
      const rs = await Promise.all([s.resgatar(a, p, chave()), s.resgatar(b, p, chave())]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(erros(rs)).toEqual(["esgotado"]);
      expect(await estoque(p)).toBe(0);
      expect(await contar("vales", "premio_id = $1", [p])).toBe(1);
      // Quem perdeu não pagou nada.
      const perdeu = rs[0]?.ok ? b : a;
      expect(await saldo(perdeu)).toBe(1000);
    }
  });

  it("muitos cidadãos disputando 5 unidades: exatamente 5 vales, estoque 0", async () => {
    const s = servico();
    const p = await premio({ custo: 50, estoque: 5 });
    const pessoas = await Promise.all(Array.from({ length: 20 }, () => cidadao(500)));
    const rs = await Promise.all(pessoas.map((u) => s.resgatar(u, p, chave())));
    expect(rs.filter((r) => r.ok)).toHaveLength(5);
    expect(new Set(erros(rs))).toEqual(new Set(["esgotado"]));
    expect(await estoque(p)).toBe(0);
  });

  it("critério 2: resgates simultâneos do mesmo cidadão nunca deixam o saldo negativo", async () => {
    const s = servico();
    const u = await cidadao(500);
    const p = await premio({ custo: 200, estoque: 100 });
    const rs = await Promise.all(Array.from({ length: 12 }, () => s.resgatar(u, p, chave())));
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    expect(new Set(erros(rs))).toEqual(new Set(["saldo_insuficiente"]));
    expect(await saldo(u)).toBe(100);
    // O saldo guardado bate com a soma do livro-razão.
    expect(await somaLivro(u)).toBe(100);
    expect(await estoque(p)).toBe(98);
  });

  it("mesmo cidadão, prêmios diferentes ao mesmo tempo: saldo nunca negativo", async () => {
    const s = servico();
    const u = await cidadao(1000);
    const ps = await Promise.all([300, 400, 500, 600].map((custo) => premio({ custo, estoque: 10 })));
    const rs = await Promise.all(ps.flatMap((p) => [s.resgatar(u, p, chave()), s.resgatar(u, p, chave())]));
    const gasto = rs.reduce((t, r) => t + (r.ok ? r.vale.custo : 0), 0);
    expect(gasto).toBeLessThanOrEqual(1000);
    expect(await saldo(u)).toBe(1000 - gasto);
    expect(await somaLivro(u)).toBe(1000 - gasto);
  });

  it("limite mensal com pedidos simultâneos: não passa do limite", async () => {
    const s = servico();
    const u = await cidadao(5000);
    const p = await premio({ custo: 10, estoque: 50, limitePorMes: 2 });
    const rs = await Promise.all(Array.from({ length: 8 }, () => s.resgatar(u, p, chave())));
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    expect(new Set(erros(rs))).toEqual(new Set(["limite_mensal"]));
  });
});

describe("idempotência no PostgreSQL", () => {
  it("critério 3: a mesma Idempotency-Key em pedidos simultâneos gera um único vale e um único débito", async () => {
    const s = servico();
    const u = await cidadao(1000);
    const p = await premio({ custo: 300, estoque: 10 });
    const k = chave();
    const rs = await Promise.all(Array.from({ length: 6 }, () => s.resgatar(u, p, k)));
    expect(rs.every((r) => r.ok)).toBe(true);
    const codigos = new Set(rs.map((r) => (r.ok ? r.vale.codigo : "")));
    expect(codigos.size).toBe(1);
    expect(rs.filter((r) => r.ok && !r.repetido)).toHaveLength(1);
    expect(await contar("vales", "usuario_id = $1", [u])).toBe(1);
    expect(await contar("lancamentos", "usuario_id = $1 AND tipo = 'resgate'", [u])).toBe(1);
    expect(await saldo(u)).toBe(700);
    expect(await estoque(p)).toBe(9);
  });

  it("reenvio depois de concluído devolve o mesmo vale, sem novo débito", async () => {
    const s = servico();
    const u = await cidadao(1000);
    const p = await premio({ custo: 300, estoque: 10 });
    const k = chave();
    const a = await s.resgatar(u, p, k);
    const b = await s.resgatar(u, p, k);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.repetido).toBe(true);
    expect(b.vale.codigo).toBe(a.vale.codigo);
    expect(await saldo(u)).toBe(700);
  });

  it("a mesma chave para outro prêmio é recusada", async () => {
    const s = servico();
    const u = await cidadao(1000);
    const [p1, p2] = [await premio({ custo: 100, estoque: 5 }), await premio({ custo: 100, estoque: 5 })];
    const k = chave();
    expect((await s.resgatar(u, p1, k)).ok).toBe(true);
    expect(await s.resgatar(u, p2, k)).toEqual({ ok: false, erro: "idempotency_key_reutilizada", bloqueio: null });
    expect(await saldo(u)).toBe(900);
  });

  it("um pedido que falhou por regra pode ser repetido com a mesma chave", async () => {
    const s = servico();
    const u = await cidadao(100);
    const p = await premio({ custo: 300, estoque: 5 });
    const k = chave();
    const r1 = await s.resgatar(u, p, k);
    expect(r1.ok).toBe(false);
    await db.transacao((tx) => lancar(tx, { usuarioId: u, tipo: "entrega", pontos: 200, descricao: "Entrega", em: agora() }));
    const r2 = await s.resgatar(u, p, k);
    expect(r2.ok).toBe(true);
    expect(await saldo(u)).toBe(0);
  });
});

describe("tudo ou nada", () => {
  it("se um passo falha depois da baixa do estoque, nada é gravado", async () => {
    // Bytes fixos: o código do vale sempre colide com um existente.
    const fixo = () => new Uint8Array([1, 2, 3, 4, 5, 6]);
    const u = await cidadao(1000);
    const p = await premio({ custo: 100, estoque: 5 });
    const primeiro = await servico({ bytesAleatorios: fixo }).resgatar(u, p, chave());
    expect(primeiro.ok).toBe(true);

    const k = chave();
    await expect(servico({ bytesAleatorios: fixo }).resgatar(u, p, k)).rejects.toThrow(/código de vale único/);
    expect(await estoque(p)).toBe(4);
    expect(await saldo(u)).toBe(900);
    expect(await contar("lancamentos", "usuario_id = $1 AND tipo = 'resgate'", [u])).toBe(1);
    expect(await contar("resgate_idempotencia", "usuario_id = $1 AND chave = $2", [u, k])).toBe(0);
  });

  it("o banco recusa saldo e estoque negativos (última defesa)", async () => {
    const u = await cidadao(50);
    const p = await premio({ custo: 10, estoque: 0 });
    await expect(db.query("UPDATE saldos SET pontos = pontos - 51 WHERE usuario_id = $1", [u])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE premios SET estoque = estoque - 1 WHERE id = $1", [p])).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.transacao((tx) => lancar(tx, { usuarioId: u, tipo: "resgate", pontos: 51, descricao: "x", em: agora() })),
    ).rejects.toMatchObject({ constraint: "saldo_nao_negativo" });
    expect(await somaLivro(u)).toBe(50);
  });
});
