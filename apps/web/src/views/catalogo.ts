import { CATEGORIAS, type CatalogoCidadao, type Categoria, type PremioResumo } from "@ecoponto/contracts";
import { CATEGORIAS_ROTULO, formatInteiro, formatPontos } from "@ecoponto/format";
import { h } from "../dom.ts";
import { icone } from "../icons.ts";
import type { FiltrosCatalogo, Ordem } from "../router.ts";
import { barraFalta, foto, linhaBloqueio, linkInterno } from "./comuns.ts";
import { vazio } from "./estados.ts";

export function textoEstoqueBaixo(estoque: number): string {
  return estoque === 1 ? "Última unidade" : `Últimas ${formatInteiro(estoque)} unidades`;
}

/** Só filtra e ordena o que o servidor mandou; o bloqueio vem pronto. */
export function filtrar(premios: readonly PremioResumo[], f: FiltrosCatalogo): PremioResumo[] {
  const lista = premios.filter((p) => (!f.categoria || p.categoria === f.categoria) && (!f.possoTrocar || p.bloqueio === null));
  return lista.sort((a, b) => (f.ordem === "maior" ? b.custo - a.custo : a.custo - b.custo) || a.nome.localeCompare(b.nome, "pt-BR"));
}

function cardPremio(p: PremioResumo, saldo: number): HTMLElement {
  const b = p.bloqueio;
  return h(
    "li",
    null,
    linkInterno(
      { nome: "premio", id: p.id },
      { class: `card-premio${b ? " card-premio--bloqueado" : ""}`, "data-premio": p.id },
      foto(p.fotoUrl, p.nome, "card-premio__foto"),
      h(
        "div",
        { class: "card-premio__corpo" },
        h("h3", { class: "card-premio__nome" }, p.nome),
        h("p", { class: "card-premio__custo" }, formatPontos(p.custo)),
        p.estoqueBaixo && !b
          ? h("p", { class: "selo selo--estoque", "data-estoque-baixo": "" }, icone("package", "icon--sm"), textoEstoqueBaixo(p.estoque))
          : null,
        b ? linhaBloqueio(b) : null,
        b?.codigo === "saldo_insuficiente" ? barraFalta(saldo, p.custo) : null,
      ),
    ),
  );
}

export type AoFiltrar = (f: FiltrosCatalogo) => void;

function filtros(f: FiltrosCatalogo, aoFiltrar: AoFiltrar): HTMLElement {
  const chip = (cat: Categoria | null, texto: string) =>
    h(
      "button",
      {
        type: "button",
        class: "chip",
        "aria-pressed": String(f.categoria === cat),
        "data-categoria": cat ?? "todas",
        "on:click": () => aoFiltrar({ ...f, categoria: cat }),
      },
      texto,
    );
  const ordem = h(
    "select",
    {
      id: "ordem",
      class: "select",
      "on:change": (e: Event) => aoFiltrar({ ...f, ordem: (e.target as HTMLSelectElement).value as Ordem }),
    },
    h("option", { value: "menor", selected: f.ordem === "menor" }, "Menor custo"),
    h("option", { value: "maior", selected: f.ordem === "maior" }, "Maior custo"),
  );
  return h(
    "div",
    { class: "filtros" },
    h(
      "div",
      { class: "chips", role: "group", "aria-label": "Categoria" },
      chip(null, "Todas"),
      CATEGORIAS.map((c) => chip(c, CATEGORIAS_ROTULO[c].rotulo)),
    ),
    h(
      "div",
      { class: "filtros__linha" },
      h(
        "button",
        {
          type: "button",
          class: "chip chip--atalho",
          "aria-pressed": String(f.possoTrocar),
          "data-atalho": "posso-trocar",
          "on:click": () => aoFiltrar({ ...f, possoTrocar: !f.possoTrocar }),
        },
        icone("circle-check", "icon--sm"),
        "Posso trocar agora",
      ),
      h("div", { class: "ordenar" }, h("label", { for: "ordem" }, "Ordenar"), ordem),
    ),
  );
}

export function viewCatalogo(c: CatalogoCidadao, f: FiltrosCatalogo, aoFiltrar: AoFiltrar): HTMLElement {
  if (c.premios.length === 0) {
    return vazio("Nenhum prêmio disponível no momento. Novos prêmios aparecem aqui e no canal Noticias.");
  }
  const lista = filtrar(c.premios, f);
  const contagem = lista.length === 1 ? "1 prêmio" : `${formatInteiro(lista.length)} prêmios`;
  return h(
    "section",
    { class: "catalogo", "aria-labelledby": "titulo-catalogo" },
    h("h2", { id: "titulo-catalogo", class: "visually-hidden" }, "Catálogo"),
    filtros(f, aoFiltrar),
    h("p", { class: "contagem", role: "status", "aria-live": "polite" }, contagem),
    lista.length
      ? h("ul", { class: "grade", "data-lista": "premios" }, lista.map((p) => cardPremio(p, c.saldo)))
      : vazio(
          f.possoTrocar ? "Você ainda não tem pontos para trocar por estes prêmios." : "Nenhum prêmio nesta categoria agora.",
          h(
            "button",
            { type: "button", class: "botao botao--secundario", "on:click": () => aoFiltrar({ categoria: null, possoTrocar: false, ordem: f.ordem }) },
            "Ver todos os prêmios",
          ),
        ),
  );
}
