import type { Bloqueio, StatusVale } from "@ecoponto/contracts";
import { formatPontos, STATUS_VALE } from "@ecoponto/format";
import { h, type Filho } from "../dom.ts";
import { ICONE_BLOQUEIO, icone, type NomeIcone } from "../icons.ts";
import { urlDaRota, type Rota } from "../router.ts";

/** Link dentro da página (o app troca a tela sem recarregar). */
export function linkInterno(rota: Rota, attrs: Record<string, string>, ...filhos: Filho[]): HTMLAnchorElement {
  return h("a", { href: urlDaRota(rota), "data-interno": "", ...attrs }, ...filhos);
}

export function voltar(rota: Rota, texto: string): HTMLElement {
  return h("p", { class: "voltar" }, linkInterno(rota, { class: "link link--voltar" }, icone("chevron-left", "icon--sm"), texto));
}

/** "Seu saldo: 1.250 pontos", logo abaixo do cabeçalho. */
export function faixaSaldo(saldo: number | null): HTMLElement {
  return h(
    "div",
    { class: "saldo", "data-saldo": saldo ?? "" },
    h(
      "p",
      { class: "saldo__inner" },
      saldo === null
        ? h("span", { class: "sk sk--saldo", "aria-hidden": "true" })
        : [h("span", { class: "saldo__rotulo" }, "Seu saldo: "), h("strong", { class: "saldo__valor" }, formatPontos(saldo))],
    ),
  );
}

export function abas(ativa: "catalogo" | "vales"): HTMLElement {
  const aba = (nome: "catalogo" | "vales", rota: Rota, texto: string) =>
    h("li", null, linkInterno(rota, { class: "aba", ...(ativa === nome ? { "aria-current": "page" } : {}) }, texto));
  return h(
    "nav",
    { class: "abas", "aria-label": "Prêmios" },
    h(
      "ul",
      { class: "abas__lista" },
      aba("catalogo", { nome: "catalogo", filtros: { categoria: null, possoTrocar: false, ordem: "menor" } }, "Catálogo"),
      aba("vales", { nome: "vales", filtro: "disponiveis" }, "Meus vales"),
    ),
  );
}

/** Foto com proporção fixa; o texto alternativo é o nome do prêmio. */
export function foto(url: string, nome: string, classe = ""): HTMLElement {
  return h(
    "div",
    { class: `foto ${classe}`.trim() },
    h("img", { src: url, alt: nome, loading: "lazy", decoding: "async", width: 400, height: 300 }),
  );
}

/** Selo de status do vale: ícone + texto + cor (nunca só cor). */
export function seloStatus(status: StatusVale): HTMLElement {
  const info = STATUS_VALE[status];
  return h("span", { class: `selo selo--${status}`, "data-status": status }, icone(info.icone, "icon--sm"), info.rotulo);
}

/** Motivo de bloqueio em texto com ícone. */
export function linhaBloqueio(b: Bloqueio, classe = ""): HTMLElement {
  return h(
    "p",
    { class: `bloqueio ${classe}`.trim(), "data-bloqueio": b.codigo },
    icone(ICONE_BLOQUEIO[b.codigo], "icon--sm"),
    h("span", null, b.texto),
  );
}

/** Barra do quanto já tem do custo (o texto "Faltam N pontos" vem junto). */
export function barraFalta(saldo: number, custo: number): HTMLElement {
  const pct = Math.max(0, Math.min(100, Math.floor((saldo / custo) * 100)));
  return h(
    "div",
    { class: "barra", "aria-hidden": "true" },
    h("span", { class: "barra__preenchido", style: `width:${pct}%` }),
  );
}

export function caixa(tom: "aviso" | "erro" | "sucesso" | "info", nome: NomeIcone, ...filhos: Filho[]): HTMLElement {
  return h(
    "div",
    { class: `caixa caixa--${tom}`, role: tom === "erro" ? "alert" : "status" },
    icone(nome),
    h("div", { class: "caixa__texto" }, ...filhos),
  );
}
