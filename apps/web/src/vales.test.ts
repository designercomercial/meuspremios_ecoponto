/** Telas: Meus vales e o vale (QR, status, histórico, endereço próprio, offline). */
import type { AppMock } from "@ecoponto/api";
import { cancelarVale } from "@ecoponto/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGORA, clicar, fetchComo, fetchSemRede, memoria, montar, novaApi, pares, q, qa, texto } from "./test/ambiente.ts";

let api: AppMock;
beforeEach(async () => {
  api = await novaApi();
});
afterEach(async () => {
  await api.close();
});

const cardVale = (raiz: HTMLElement, codigo: string) => q(raiz, `[data-vale="${codigo}"]`);

describe("Meus vales", () => {
  it("padrão: só os disponíveis, com código, status e prazo", async () => {
    const { raiz } = await montar("/premios/vales", fetchComo(api, "dev-cidadao-luz"));
    expect(q(raiz, '.aba[aria-current="page"]')?.textContent).toBe("Meus vales");
    expect(q(raiz, '[data-filtro="disponiveis"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(qa(raiz, ".card-vale").map((c) => c.dataset.vale).sort()).toEqual(["ECO-7K3P-9Q", "ECO-9F6H-3W"]);
    const c = cardVale(raiz, "ECO-7K3P-9Q")!;
    expect(texto(c.querySelector(".card-vale__nome"))).toBe("Kit hortifrúti da feira");
    expect(texto(c.querySelector(".card-vale__codigo"))).toBe("ECO-7K3P-9Q");
    expect(texto(c.querySelector(".selo"))).toBe("Disponível");
    expect(texto(c.querySelector(".card-vale__prazo"))).toMatch(/^Retire até \d{2}\/\d{2}$/);
    expect(c.querySelector("img")?.getAttribute("alt")).toBe("Kit hortifrúti da feira");
  });

  it("destaque para o vale que vence em até 7 dias", async () => {
    const { raiz } = await montar("/premios/vales", fetchComo(api, "dev-cidadao-luz"));
    const vence = cardVale(raiz, "ECO-9F6H-3W")!;
    expect(vence.classList.contains("card-vale--vence")).toBe(true);
    expect(texto(vence.querySelector(".card-vale__prazo"))).toBe("Retire até 16/11 · Vence em breve");
    expect(cardVale(raiz, "ECO-7K3P-9Q")?.classList.contains("card-vale--vence")).toBe(false);
  });

  it("'Todos': os 5 vales; critério 9: status em texto e ícone, não só cor", async () => {
    const { app, raiz } = await montar("/premios/vales", fetchComo(api, "dev-cidadao-luz"));
    await clicar(app, q(raiz, '[data-filtro="todos"]'));
    expect(location.search).toBe("?filtro=todos");
    const status = Object.fromEntries(qa(raiz, ".card-vale").map((c) => [c.dataset.vale, texto(c.querySelector(".selo"))]));
    expect(status).toEqual({
      "ECO-7K3P-9Q": "Disponível",
      "ECO-4M8R-2T": "Retirado",
      "ECO-9F6H-3W": "Disponível",
      "ECO-5X2N-8D": "Cancelado",
      "ECO-3B7C-6L": "Vencido",
    });
    for (const selo of qa(raiz, ".card-vale .selo")) expect(selo.querySelector("svg[data-icone]")).not.toBeNull();
  });

  it("sem vales: mensagem com link para o catálogo", async () => {
    const { app, raiz } = await montar("/premios/vales", fetchComo(api, "dev-cidadao-novo"));
    expect(texto(q(raiz, '[data-estado="vazio"] p'))).toBe("Você ainda não trocou nenhum prêmio.");
    await clicar(app, q(raiz, '[data-estado="vazio"] a'));
    expect(location.pathname).toBe("/premios/");
    expect(qa(raiz, ".card-premio")).toHaveLength(12);
  });

  it("toque no card abre o vale", async () => {
    const { app, raiz } = await montar("/premios/vales", fetchComo(api, "dev-cidadao-luz"));
    await clicar(app, cardVale(raiz, "ECO-7K3P-9Q"));
    expect(location.pathname).toBe("/premios/vale/ECO-7K3P-9Q");
    expect(q(raiz, ".qr")).not.toBeNull();
  });
});

describe("vale", () => {
  it("critério 7: o endereço /premios/vale/{codigo} abre o vale direto, com QR, código e dica", async () => {
    const { raiz } = await montar("/premios/vale/ECO-7K3P-9Q", fetchComo(api, "dev-cidadao-luz"));
    const qr = q(raiz, ".qr")!;
    expect(qr.getAttribute("role")).toBe("img");
    expect(qr.getAttribute("aria-label")).toBe("QR do vale E C O, 7 K 3 P, 9 Q");
    expect(Number(qr.getAttribute("data-modulos"))).toBeGreaterThanOrEqual(21);
    expect(texto(q(raiz, "[data-codigo]"))).toBe("ECO-7K3P-9Q");
    expect(texto(q(raiz, "[data-texto-status]"))).toBe("Disponível para retirada");
    expect(texto(q(raiz, ".dica"))).toBe("Aumente o brilho da tela para o atendente ler mais rápido.");
    const [premio, data, prazo] = pares(q(raiz, ".vale .dados"));
    expect(premio).toBe("Prêmio Kit hortifrúti da feira · 300 pontos");
    expect(data).toMatch(/^Data da troca \d{2}\/11\/2026$/);
    expect(prazo).toMatch(/^Prazo para retirar Até \d{2}\/12\/2026$/);
    expect(texto(q(raiz, ".nota"))).toBe("Precisa cancelar este vale? Fale conosco");
  });

  it("critério 7: o vale de outro cidadão não abre", async () => {
    const { raiz } = await montar("/premios/vale/ECO-7K3P-9Q", fetchComo(api, "dev-cidadao-novo"));
    expect(texto(q(raiz, '[data-estado="nao-encontrado"] .estado__titulo'))).toBe("Não encontramos este vale.");
    expect(q(raiz, ".qr")).toBeNull();
    expect(raiz.textContent).not.toContain("Kit hortifrúti");
  });

  it("vale retirado: sem QR, com o status e o histórico", async () => {
    const { raiz } = await montar("/premios/vale/ECO-4M8R-2T", fetchComo(api, "dev-cidadao-luz"));
    expect(q(raiz, ".qr")).toBeNull();
    expect(texto(q(raiz, "[data-texto-status]"))).toMatch(/^Retirado em \d{2}\/11\/2026 no Ecoponto Asa Branca$/);
    expect(qa(raiz, ".linha-tempo__item").map((i) => i.dataset.evento)).toEqual(["resgatado", "retirado"]);
  });

  it("vale vencido: sem QR, 'Prazo de retirada encerrado'", async () => {
    const { raiz } = await montar("/premios/vale/ECO-3B7C-6L", fetchComo(api, "dev-cidadao-luz"));
    expect(q(raiz, ".qr")).toBeNull();
    expect(texto(q(raiz, "[data-texto-status]"))).toBe("Prazo de retirada encerrado");
    expect(texto(q(raiz, ".selo"))).toBe("Vencido");
  });

  it("critério 6: vale cancelado mostra o status e o estorno no histórico", async () => {
    // Troca de verdade, depois a gestão cancela (T27).
    const r = await api.inject({
      method: "POST",
      url: "/api/cidadao/premios/prm_cafe-regional/resgatar",
      headers: { authorization: "Bearer dev-cidadao-luz", "idempotency-key": "tela-cancelado-000001" },
    });
    const codigo = (r.json() as { vale: { codigo: string } }).vale.codigo;
    await cancelarVale(api.db, { codigo, gestor: "gestao:teste", em: AGORA });

    const { raiz } = await montar(`/premios/vale/${codigo}`, fetchComo(api, "dev-cidadao-luz"));
    expect(q(raiz, ".qr")).toBeNull();
    expect(texto(q(raiz, "[data-texto-status]"))).toBe("Cancelado. Os pontos voltaram para o seu saldo.");
    expect(texto(q(raiz, '[data-evento="estornado"] .linha-tempo__texto'))).toBe("250 pontos voltaram para o seu saldo");
    expect(q(raiz, 'a[href="/pontos/"]')).not.toBeNull();
  });

  it("critério 8: offline, os vales disponíveis continuam visíveis com o QR", async () => {
    const storage = memoria();
    // Online uma vez: a lista guarda cada vale no aparelho.
    await montar("/premios/vales", fetchComo(api, "dev-cidadao-luz"), { storage });

    const lista = await montar("/premios/vales", fetchSemRede, { storage, online: false });
    expect(texto(q(lista.raiz, '[data-estado="offline"] p'))).toBe("Sem internet. Dados de 11/11 às 10:00.");
    expect(qa(lista.raiz, ".card-vale")).toHaveLength(2);

    // O vale abre sem nunca ter sido aberto antes, com o QR para a portaria.
    const { raiz } = await montar("/premios/vale/ECO-9F6H-3W", fetchSemRede, { storage, online: false });
    expect(q(raiz, ".qr")).not.toBeNull();
    expect(texto(q(raiz, "[data-codigo]"))).toBe("ECO-9F6H-3W");
    expect(q(raiz, '[data-estado="offline"]')).not.toBeNull();
  });
});
