import type { DetalheResposta, PremioDetalhe } from "@ecoponto/contracts";
import { formatData, formatInteiro, formatPontos } from "@ecoponto/format";
import { h } from "../dom.ts";
import { icone } from "../icons.ts";
import { CATALOGO_PADRAO } from "../router.ts";
import { barraFalta, caixa, foto, linhaBloqueio, voltar } from "./comuns.ts";
import { textoEstoqueBaixo } from "./catalogo.ts";

export type Mensagem = { tom: "erro" | "aviso"; texto: string } | null;

export function viewDetalhe(
  d: DetalheResposta,
  o: { offline: boolean; mensagem: Mensagem; aoTrocar: () => void },
): HTMLElement {
  const p = d.premio;
  const b = p.bloqueio;
  const bloqueado = b !== null || o.offline;

  const dado = (rotulo: string, valor: string, nome: Parameters<typeof icone>[0]) =>
    h("div", { class: "dado" }, h("dt", null, icone(nome, "icon--sm"), rotulo), h("dd", null, valor));

  const estoque =
    p.estoque === 0 ? "Esgotado" : p.estoqueBaixo ? textoEstoqueBaixo(p.estoque) : `${formatInteiro(p.estoque)} unidades`;

  return h(
    "article",
    { class: "detalhe", "aria-labelledby": "titulo-premio", "data-premio": p.id },
    voltar(CATALOGO_PADRAO, "Catálogo"),
    o.mensagem ? caixa(o.mensagem.tom, o.mensagem.tom === "erro" ? "triangle-alert" : "info", h("p", null, o.mensagem.texto)) : null,
    h(
      "div",
      { class: "card detalhe__card" },
      foto(p.fotoUrl, p.nome, "foto--grande"),
      h("h2", { id: "titulo-premio", class: "detalhe__nome" }, p.nome),
      h("p", { class: "detalhe__custo" }, formatPontos(p.custo)),
      h("p", { class: "detalhe__descricao" }, p.descricao),
      h(
        "dl",
        { class: "dados" },
        dado("Estoque", estoque, "package"),
        dado("Oferta válida até", p.ofertaAte ? formatData(p.ofertaAte) : "Sem data para acabar", "calendar-clock"),
        dado("Onde retirar", p.ondeRetirar, "map-pin"),
        p.limitePorMes ? dado("Limite", p.limitePorMes === 1 ? "1 troca por mês" : `${formatInteiro(p.limitePorMes)} trocas por mês`, "repeat") : null,
        p.nivelMinimo ? dado("Nível mínimo", `Nível ${p.nivelMinimo}`, "lock") : null,
      ),
    ),
    h(
      "div",
      { class: "acao" },
      bloqueado
        ? h(
            "div",
            { id: "motivo-bloqueio", class: "acao__motivo" },
            b
              ? linhaBloqueio(b)
              : h("p", { class: "bloqueio", "data-bloqueio": "offline" }, icone("wifi-off", "icon--sm"), h("span", null, "Sem internet. Conecte-se para trocar.")),
            b?.codigo === "saldo_insuficiente" ? barraFalta(d.saldo, p.custo) : null,
          )
        : null,
      h(
        "button",
        {
          type: "button",
          class: "botao botao--largo",
          id: "trocar",
          disabled: bloqueado,
          "aria-describedby": bloqueado ? "motivo-bloqueio" : null,
          "on:click": () => o.aoTrocar(),
        },
        icone("gift", "icon--sm"),
        `Trocar por ${formatPontos(p.custo)}`,
      ),
    ),
  );
}

/**
 * Diálogo de confirmação (modal acessível): foco preso no diálogo, Esc fecha,
 * o foco volta ao botão "Trocar" ao fechar.
 */
export function dialogoConfirmacao(
  p: PremioDetalhe,
  saldo: number,
  o: { confirmar: () => void; voltar: () => void },
): { el: HTMLElement; ocupado(sim: boolean): void } {
  const confirmar = h(
    "button",
    { type: "button", class: "botao botao--largo", "data-acao": "confirmar", "on:click": () => o.confirmar() },
    "Confirmar troca",
  );
  const btnVoltar = h(
    "button",
    { type: "button", class: "botao botao--secundario botao--largo", "data-acao": "voltar", "on:click": () => o.voltar() },
    "Voltar",
  );
  const caixaDialogo = h(
    "div",
    { class: "dialogo", role: "dialog", "aria-modal": "true", "aria-labelledby": "dialogo-titulo", "aria-describedby": "dialogo-texto" },
    h("h2", { id: "dialogo-titulo", class: "dialogo__titulo" }, `Trocar ${formatPontos(p.custo)} por ${p.nome}?`),
    h(
      "div",
      { id: "dialogo-texto", class: "dialogo__texto" },
      h("p", null, `Seu saldo vai ficar em ${formatPontos(saldo - p.custo)}.`),
      h("p", null, `Retire em qualquer ecoponto até ${formatData(p.retirarAteSeTrocarAgora)}.`),
    ),
    h("div", { class: "dialogo__botoes" }, confirmar, btnVoltar),
  );
  const fundo = h("div", { class: "dialogo-fundo", "data-dialogo": "confirmacao" }, caixaDialogo);

  fundo.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !confirmar.disabled) {
      e.preventDefault();
      o.voltar();
    }
    if (e.key === "Tab") {
      const focaveis = [confirmar, btnVoltar].filter((x) => !x.disabled);
      const primeiro = focaveis[0];
      const ultimo = focaveis.at(-1);
      if (!primeiro || !ultimo) return;
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
  });

  return {
    el: fundo,
    ocupado(sim) {
      // Toque duplo não gera dois pedidos: o botão trava enquanto espera.
      confirmar.disabled = sim;
      btnVoltar.disabled = sim;
      confirmar.setAttribute("aria-busy", String(sim));
      confirmar.textContent = sim ? "Trocando…" : "Confirmar troca";
    },
  };
}
