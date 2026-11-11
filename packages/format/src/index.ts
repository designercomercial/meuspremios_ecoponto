/**
 * Formatação pt-BR e rótulos para a tela.
 *
 * Nada aqui calcula pontos, saldo ou bloqueio: só transforma o que o servidor
 * mandou em texto. Datas sempre no fuso de Boa Vista.
 */
import type { Categoria, EventoVale, StatusVale } from "@ecoponto/contracts";

export const FUSO = "America/Boa_Vista";

/** Sinal de menos tipográfico (U+2212), não hífen. */
export const MENOS = "−";

/**
 * 1250 → "1.250". Agrupa à mão porque o ICU em pt-BR não separa números de
 * 4 dígitos ("1250"), e a especificação pede "1.250 pontos".
 */
export function formatInteiro(n: number): string {
  if (!Number.isFinite(n)) return "";
  const agrupado = String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? MENOS : "") + agrupado;
}

/** 1250 → "1.250 pontos"; 1 → "1 ponto". */
export function formatPontos(pontos: number): string {
  return `${formatInteiro(pontos)} ${Math.abs(pontos) === 1 ? "ponto" : "pontos"}`;
}

// ---------------------------------------------------------------------------
// Datas (fuso de Boa Vista)
// ---------------------------------------------------------------------------

type Partes = { ano: string; mes: string; dia: string; hora: string; minuto: string };

const partesFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function partes(data: string | Date): Partes {
  const p: Record<string, string> = {};
  for (const { type, value } of partesFmt.formatToParts(new Date(data))) p[type] = value;
  return { ano: p.year ?? "", mes: p.month ?? "", dia: p.day ?? "", hora: p.hour ?? "", minuto: p.minute ?? "" };
}

/** → "15/12/2026". */
export function formatData(iso: string): string {
  const p = partes(iso);
  return `${p.dia}/${p.mes}/${p.ano}`;
}

/** → "15/12". Prazo de retirada no card ("Retire até 15/12"). */
export function formatDiaMes(iso: string): string {
  const p = partes(iso);
  return `${p.dia}/${p.mes}`;
}

/** → "15/12/2026 às 14:32". */
export function formatDataHora(iso: string): string {
  const p = partes(iso);
  return `${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}`;
}

/** → "11/11 às 14:32". Usado no aviso de offline. */
export function formatDiaHora(iso: string): string {
  const p = partes(iso);
  return `${p.dia}/${p.mes} às ${p.hora}:${p.minuto}`;
}

// ---------------------------------------------------------------------------
// Rótulos e ícones
// ---------------------------------------------------------------------------

/** Nomes de ícones Lucide usados nos rótulos (a web mapeia nome → SVG). */
export type NomeIcone =
  | "utensils"
  | "house"
  | "ticket"
  | "wrench"
  | "circle-check"
  | "package-check"
  | "circle-x"
  | "clock-alert"
  | "gift"
  | "undo-2"
  | "package-x"
  | "calendar-x"
  | "lock"
  | "repeat"
  | "coins";

export const CATEGORIAS_ROTULO: Readonly<Record<Categoria, { rotulo: string; icone: NomeIcone }>> = {
  alimentacao: { rotulo: "Alimentação", icone: "utensils" },
  casa: { rotulo: "Casa", icone: "house" },
  lazer: { rotulo: "Lazer", icone: "ticket" },
  servicos: { rotulo: "Serviços", icone: "wrench" },
};

export type InfoStatus = { rotulo: string; icone: NomeIcone };

export const STATUS_VALE: Readonly<Record<StatusVale, InfoStatus>> = {
  disponivel: { rotulo: "Disponível", icone: "circle-check" },
  retirado: { rotulo: "Retirado", icone: "package-check" },
  cancelado: { rotulo: "Cancelado", icone: "circle-x" },
  vencido: { rotulo: "Vencido", icone: "clock-alert" },
};

export const EVENTOS_VALE: Readonly<Record<EventoVale, NomeIcone>> = {
  resgatado: "gift",
  retirado: "package-check",
  cancelado: "circle-x",
  estornado: "undo-2",
  vencido: "clock-alert",
};

/** Texto do status no vale, como pede a especificação. */
export function textoStatusVale(v: {
  status: StatusVale;
  retirada: { em: string; ecoponto: string } | null;
}): string {
  switch (v.status) {
    case "disponivel":
      return "Disponível para retirada";
    case "retirado":
      return v.retirada ? `Retirado em ${formatData(v.retirada.em)} no ${v.retirada.ecoponto}` : "Retirado";
    case "cancelado":
      return "Cancelado. Os pontos voltaram para o seu saldo.";
    case "vencido":
      return "Prazo de retirada encerrado";
  }
}
