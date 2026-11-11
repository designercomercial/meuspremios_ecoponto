import type { Vale } from "@ecoponto/contracts";
import { EVENTOS_VALE, formatData, formatDataHora, formatPontos, textoStatusVale } from "@ecoponto/format";
import type { Links } from "../config.ts";
import { h } from "../dom.ts";
import { icone } from "../icons.ts";
import { qrSvg } from "../qr.ts";
import { caixa, foto, seloStatus, voltar } from "./comuns.ts";

/** "ECO-7K3P-9Q" lido letra a letra pelo leitor de tela. */
export function soletrar(codigo: string): string {
  return codigo
    .split("-")
    .map((parte) => parte.split("").join(" "))
    .join(", ");
}

export function viewVale(v: Vale, o: { novo: boolean; links: Links }): HTMLElement {
  const disponivel = v.status === "disponivel";
  return h(
    "article",
    { class: "vale", "aria-labelledby": "titulo-vale", "data-vale": v.codigo, "data-status": v.status },
    voltar({ nome: "vales", filtro: "disponiveis" }, "Meus vales"),
    o.novo && disponivel
      ? caixa("sucesso", "circle-check", h("p", { class: "caixa__titulo" }, "Troca feita. Mostre este vale na portaria de um ecoponto."))
      : null,
    h(
      "div",
      { class: "card vale__card" },
      h("div", { class: "vale__topo" }, foto(v.premio.fotoUrl, v.premio.nome, "vale__foto"), h("h2", { id: "titulo-vale", class: "vale__nome" }, v.premio.nome)),
      h("p", { class: "vale__status" }, seloStatus(v.status), h("span", { "data-texto-status": "" }, textoStatusVale(v))),
      disponivel
        ? h(
            "div",
            { class: "vale__qr" },
            // Sempre preto sobre branco, também no tema escuro.
            h("div", { class: "qr-moldura" }, qrSvg(v.codigo, `QR do vale ${soletrar(v.codigo)}`)),
            h("p", { class: "vale__codigo-rotulo" }, "Código do vale"),
            h("p", { class: "vale__codigo", "aria-label": soletrar(v.codigo), "data-codigo": "" }, v.codigo),
            h("p", { class: "dica" }, icone("sun", "icon--sm"), h("span", null, "Aumente o brilho da tela para o atendente ler mais rápido.")),
          )
        : h("p", { class: "vale__codigo vale__codigo--inativo code", "data-codigo": "" }, v.codigo),
      h(
        "dl",
        { class: "dados" },
        h("div", { class: "dado" }, h("dt", null, "Prêmio"), h("dd", null, `${v.premio.nome} · ${formatPontos(v.custo)}`)),
        h("div", { class: "dado" }, h("dt", null, "Data da troca"), h("dd", null, formatData(v.resgatadoEm))),
        h(
          "div",
          { class: `dado${v.venceEmBreve ? " dado--vence" : ""}` },
          h("dt", null, "Prazo para retirar"),
          h("dd", null, `Até ${formatData(v.retirarAte)}`, v.venceEmBreve ? h("strong", null, " · Vence em breve") : null),
        ),
      ),
    ),
    disponivel
      ? h(
          "p",
          { class: "nota" },
          "Precisa cancelar este vale? ",
          h("a", { class: "link", href: o.links.faleConosco }, icone("message-circle", "icon--sm"), "Fale conosco"),
        )
      : h(
          "section",
          { class: "card historico", "aria-labelledby": "titulo-historico" },
          h("h3", { id: "titulo-historico", class: "card__titulo" }, "Histórico"),
          h(
            "ol",
            { class: "linha-tempo" },
            v.historico.map((e) =>
              h(
                "li",
                { class: "linha-tempo__item", "data-evento": e.evento },
                icone(EVENTOS_VALE[e.evento], "icon--sm"),
                h("div", null, h("p", { class: "linha-tempo__texto" }, e.texto), h("p", { class: "linha-tempo__data" }, formatDataHora(e.em))),
              ),
            ),
          ),
          v.status === "cancelado" ? h("p", null, h("a", { class: "link", href: o.links.meusPontos }, "Ver o estorno em Meus Pontos", icone("chevron-right", "icon--sm"))) : null,
        ),
  );
}
