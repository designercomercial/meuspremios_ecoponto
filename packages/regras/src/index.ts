/**
 * Regras de negócio dos prêmios. Funções puras: sem banco, sem relógio, sem
 * aleatoriedade escondida. O servidor usa as MESMAS funções para montar o
 * catálogo (motivo de bloqueio exibido) e para conferir o resgate dentro da
 * transação. A página não calcula nada disto.
 */
import { ALFABETO_VALE, type Bloqueio, type StatusVale } from "@ecoponto/contracts";
import { formatInteiro, formatPontos, partes } from "@ecoponto/format";

/** Boa Vista não tem horário de verão desde 2019: UTC−4 o ano todo. */
export const OFFSET_BOA_VISTA = "-04:00";

/** [DEFINIR] Prazo para retirar o vale. Padrão adotado: 30 dias. */
export const DIAS_PARA_RETIRAR = 30;
/** Vale que vence em até 7 dias ganha destaque. */
export const DIAS_VENCE_EM_BREVE = 7;
/** Estoque de 1 a 3: selo "Últimas 3 unidades". */
export const ESTOQUE_BAIXO = 3;

const DIA_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Bloqueio
// ---------------------------------------------------------------------------

export type PremioParaRegra = {
  ativo: boolean;
  custo: number;
  estoque: number;
  /** Fim da oferta (inclusive). null = sem data. */
  ofertaAte: Date | null;
  nivelMinimo: number | null;
  limitePorMes: number | null;
};

export type CidadaoParaRegra = {
  saldo: number;
  nivel: number;
  /** Vales deste prêmio no mês corrente (Boa Vista), sem contar os cancelados. */
  resgatesNoMes: number;
};

export type OpcoesRegra = {
  agora: Date;
  /** [DEFINIR] Fase 3. Desligada: o nível mínimo é ignorado. */
  gamificacaoAtiva: boolean;
};

/**
 * Motivo de bloqueio do prêmio para este cidadão, ou null se pode trocar.
 * Ordem: esgotado → oferta encerrada → nível → limite do mês → saldo.
 */
export function avaliarBloqueio(p: PremioParaRegra, c: CidadaoParaRegra, o: OpcoesRegra): Bloqueio | null {
  if (p.estoque <= 0) return { codigo: "esgotado", texto: "Esgotado", faltamPontos: null };
  if (!p.ativo || (p.ofertaAte !== null && o.agora.getTime() > p.ofertaAte.getTime())) {
    return { codigo: "oferta_encerrada", texto: "Oferta encerrada", faltamPontos: null };
  }
  if (o.gamificacaoAtiva && p.nivelMinimo !== null && c.nivel < p.nivelMinimo) {
    return {
      codigo: "nivel_insuficiente",
      texto: `Disponível a partir do nível ${p.nivelMinimo}`,
      faltamPontos: null,
    };
  }
  if (p.limitePorMes !== null && c.resgatesNoMes >= p.limitePorMes) {
    const vezes = c.resgatesNoMes === 1 ? "1 vez" : `${formatInteiro(c.resgatesNoMes)} vezes`;
    return { codigo: "limite_mensal", texto: `Você já trocou este prêmio ${vezes} este mês`, faltamPontos: null };
  }
  if (c.saldo < p.custo) {
    const faltam = p.custo - c.saldo;
    return { codigo: "saldo_insuficiente", texto: `Faltam ${formatPontos(faltam)}`, faltamPontos: faltam };
  }
  return null;
}

export const estoqueBaixo = (estoque: number) => estoque > 0 && estoque <= ESTOQUE_BAIXO;

// ---------------------------------------------------------------------------
// Datas em Boa Vista
// ---------------------------------------------------------------------------

/** 00:00 do dia 1º do mês corrente em Boa Vista. Base do limite mensal. */
export function inicioDoMes(agora: Date): Date {
  const p = partes(agora);
  return new Date(`${p.ano}-${p.mes}-01T00:00:00${OFFSET_BOA_VISTA}`);
}

/** Prazo de retirada: fim do dia (Boa Vista) de resgate + N dias. */
export function prazoRetirada(resgatadoEm: Date, dias = DIAS_PARA_RETIRAR): Date {
  const p = partes(new Date(resgatadoEm.getTime() + dias * DIA_MS));
  return new Date(`${p.ano}-${p.mes}-${p.dia}T23:59:59.999${OFFSET_BOA_VISTA}`);
}

/** Um vale "disponível" com o prazo passado é exibido como "vencido". */
export function statusEfetivo(gravado: StatusVale, retirarAte: Date, agora: Date): StatusVale {
  return gravado === "disponivel" && agora.getTime() > retirarAte.getTime() ? "vencido" : gravado;
}

export function venceEmBreve(status: StatusVale, retirarAte: Date, agora: Date): boolean {
  return status === "disponivel" && retirarAte.getTime() - agora.getTime() <= DIAS_VENCE_EM_BREVE * DIA_MS;
}

// ---------------------------------------------------------------------------
// Código do vale
// ---------------------------------------------------------------------------

/**
 * ECO-7K3P-9Q. 6 caracteres de um alfabeto de 32 (sem 0/O/1/I): ~1 bilhão de
 * combinações. O alfabeto tem 32 símbolos, então `byte & 31` não tem viés.
 * A unicidade é garantida pelo banco (índice único); em colisão, gera outro.
 */
export function gerarCodigoVale(bytesAleatorios: (n: number) => Uint8Array): string {
  const b = bytesAleatorios(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += ALFABETO_VALE[(b[i] ?? 0) & 31];
  return `ECO-${s.slice(0, 4)}-${s.slice(4)}`;
}
