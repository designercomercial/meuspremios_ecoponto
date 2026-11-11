import { formatDiaHora } from "@ecoponto/format";
import type { Falha } from "../api.ts";
import { h } from "../dom.ts";
import { icone } from "../icons.ts";
import { CATALOGO_PADRAO } from "../router.ts";
import { linkInterno } from "./comuns.ts";

/** Skeleton no formato do conteúdo. Sem spinner. */
export function skeleton(forma: "catalogo" | "detalhe" | "vales" | "vale"): HTMLElement {
  const b = (cls: string) => h("span", { class: `sk ${cls}` });
  const cardPremio = () => h("div", { class: "card-premio card-premio--sk" }, b("sk--foto"), h("div", { class: "card-premio__corpo" }, b("sk--texto"), b("sk--curto")));
  const cardVale = () => h("div", { class: "card-vale card-vale--sk" }, b("sk--miniatura"), h("div", { class: "sk-col" }, b("sk--texto"), b("sk--curto"), b("sk--curto")));
  const corpo =
    forma === "catalogo"
      ? [h("div", { class: "sk-filtros" }, b("sk--chip"), b("sk--chip"), b("sk--chip")), h("div", { class: "grade" }, Array.from({ length: 4 }, cardPremio))]
      : forma === "vales"
        ? [h("div", { class: "lista-vales" }, Array.from({ length: 3 }, cardVale))]
        : forma === "vale"
          ? [h("div", { class: "card" }, b("sk--qr"), b("sk--destaque"), b("sk--texto"))]
          : [h("div", { class: "card" }, b("sk--foto"), b("sk--destaque"), b("sk--texto"), b("sk--texto"), b("sk--botao"))];
  return h(
    "div",
    { class: "skeleton", "data-estado": "carregando" },
    h("p", { class: "visually-hidden", role: "status" }, "Carregando…"),
    h("div", { "aria-hidden": "true", class: "skeleton__corpo" }, corpo),
  );
}

export function botaoTentar(tentar: () => void, classe = "botao"): HTMLButtonElement {
  return h("button", { type: "button", class: classe, "on:click": () => tentar() }, icone("refresh-cw", "icon--sm"), "Tentar novamente");
}

/** Erro sem dados guardados: mensagem + "Tentar novamente". */
export function erro(falha: Falha, online: boolean, tentar: () => void): HTMLElement {
  let titulo = "Não foi possível carregar os prêmios.";
  let texto = "Verifique sua conexão e tente de novo.";
  let nome: "wifi-off" | "triangle-alert" = "triangle-alert";
  if (falha.tipo === "rede" && !online) {
    titulo = "Sem internet.";
    texto = "Conecte-se para ver os prêmios.";
    nome = "wifi-off";
  } else if (falha.tipo === "nao_autenticado") {
    titulo = "Sua sessão terminou.";
    texto = "Feche esta tela e abra Prêmios de novo pelo app.";
  } else if (falha.tipo === "servidor" || falha.tipo === "contrato") {
    texto = "O problema é do nosso lado. Tente de novo em alguns minutos.";
  }
  return h(
    "div",
    { class: "estado", role: "alert", "data-estado": "erro" },
    h("span", { class: "estado__icone" }, icone(nome)),
    h("p", { class: "estado__titulo" }, titulo),
    h("p", null, texto),
    falha.tipo === "nao_autenticado" ? null : botaoTentar(tentar),
  );
}

/** Mostrando dados guardados porque está sem internet. */
export function avisoOffline(salvoEm: string, tentar: () => void): HTMLElement {
  return h(
    "div",
    { class: "faixa-offline", role: "status", "data-estado": "offline" },
    icone("wifi-off"),
    h("p", null, `Sem internet. Dados de ${formatDiaHora(salvoEm)}.`),
    botaoTentar(tentar, "botao botao--secundario botao--pequeno"),
  );
}

export function vazio(texto: string, extra: HTMLElement | null = null, nome: "gift" | "package" = "gift"): HTMLElement {
  return h(
    "div",
    { class: "estado estado--vazio", "data-estado": "vazio" },
    h("span", { class: "estado__icone" }, icone(nome)),
    h("p", null, texto),
    extra,
  );
}

export function naoEncontrado(oque: "premio" | "vale" | "pagina"): HTMLElement {
  const texto =
    oque === "vale" ? "Não encontramos este vale." : oque === "premio" ? "Este prêmio não está mais no catálogo." : "Página não encontrada.";
  return h(
    "div",
    { class: "estado", "data-estado": "nao-encontrado" },
    h("span", { class: "estado__icone" }, icone("info")),
    h("p", { class: "estado__titulo" }, texto),
    oque === "vale"
      ? linkInterno({ nome: "vales", filtro: "todos" }, { class: "link" }, "Ver meus vales", icone("chevron-right", "icon--sm"))
      : linkInterno(CATALOGO_PADRAO, { class: "link" }, "Ver o catálogo", icone("chevron-right", "icon--sm")),
  );
}

/** Catador não troca prêmios ([DEFINIR]); recebe em Pix. */
export function avisoCatador(): HTMLElement {
  return h(
    "div",
    { class: "estado", "data-estado": "catador" },
    h("span", { class: "estado__icone" }, icone("info")),
    h("p", null, "Como catador, você recebe o valor das entregas em Pix. Os prêmios são para quem acumula pontos."),
  );
}
