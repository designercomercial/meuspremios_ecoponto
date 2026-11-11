import type { FiltroVales, Vale, ValesCidadao } from "@ecoponto/contracts";
import { formatDiaMes } from "@ecoponto/format";
import { h } from "../dom.ts";
import { icone } from "../icons.ts";
import { CATALOGO_PADRAO } from "../router.ts";
import { foto, linkInterno, seloStatus } from "./comuns.ts";
import { vazio } from "./estados.ts";

function cardVale(v: Vale): HTMLElement {
  return h(
    "li",
    null,
    linkInterno(
      { nome: "vale", codigo: v.codigo, novo: false },
      { class: `card-vale${v.venceEmBreve ? " card-vale--vence" : ""}`, "data-vale": v.codigo },
      foto(v.premio.fotoUrl, v.premio.nome, "card-vale__foto"),
      h(
        "div",
        { class: "card-vale__corpo" },
        h("h3", { class: "card-vale__nome" }, v.premio.nome),
        h("p", { class: "card-vale__codigo code" }, v.codigo),
        h("p", { class: "card-vale__linha" }, seloStatus(v.status)),
        v.status === "disponivel"
          ? h(
              "p",
              { class: `card-vale__prazo${v.venceEmBreve ? " card-vale__prazo--vence" : ""}` },
              icone(v.venceEmBreve ? "clock-alert" : "clock", "icon--sm"),
              h("span", null, `Retire até ${formatDiaMes(v.retirarAte)}`, v.venceEmBreve ? h("strong", null, " · Vence em breve") : null),
            )
          : null,
      ),
      icone("chevron-right", "card-vale__seta"),
    ),
  );
}

export function viewVales(d: ValesCidadao, filtro: FiltroVales, aoFiltrar: (f: FiltroVales) => void): HTMLElement {
  const lista = filtro === "disponiveis" ? d.vales.filter((v) => v.status === "disponivel") : d.vales;
  const botao = (f: FiltroVales, texto: string) =>
    h(
      "button",
      { type: "button", class: "chip", "aria-pressed": String(filtro === f), "data-filtro": f, "on:click": () => aoFiltrar(f) },
      texto,
    );

  let corpo: HTMLElement;
  if (d.vales.length === 0) {
    corpo = vazio(
      "Você ainda não trocou nenhum prêmio.",
      linkInterno(CATALOGO_PADRAO, { class: "link" }, "Ver o catálogo", icone("chevron-right", "icon--sm")),
    );
  } else if (lista.length === 0) {
    corpo = vazio(
      "Nenhum vale disponível para retirada agora.",
      h("button", { type: "button", class: "botao botao--secundario", "on:click": () => aoFiltrar("todos") }, "Ver todos os vales"),
      "package",
    );
  } else {
    corpo = h("ul", { class: "lista-vales", "data-lista": "vales" }, lista.map(cardVale));
  }

  return h(
    "section",
    { class: "vales", "aria-labelledby": "titulo-vales" },
    h("h2", { id: "titulo-vales", class: "visually-hidden" }, "Meus vales"),
    d.vales.length ? h("div", { class: "chips", role: "group", "aria-label": "Mostrar" }, botao("disponiveis", "Disponíveis"), botao("todos", "Todos")) : null,
    corpo,
  );
}
