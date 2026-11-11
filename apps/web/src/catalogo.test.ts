/** Telas: catálogo, estados (carregando, vazio, erro, offline) e catador. */
import type { AppMock } from "@ecoponto/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clicar, fetchComo, fetchPendente, fetchSemRede, memoria, montar, novaApi, q, qa, texto } from "./test/ambiente.ts";

let api: AppMock;
beforeEach(async () => {
  api = await novaApi();
});
afterEach(async () => {
  await api.close();
});

const card = (raiz: HTMLElement, id: string) => q(raiz, `[data-premio="${id}"]`);
const custosNaTela = (raiz: HTMLElement) =>
  qa(raiz, ".card-premio__custo").map((el) => Number(texto(el).replace(/\D/g, "")));

describe("catálogo", () => {
  it("carregando: skeleton, nunca spinner", async () => {
    const { raiz } = await montar("/premios/", fetchPendente, { esperar: false });
    expect(q(raiz, '[data-estado="carregando"]')).not.toBeNull();
    expect(q(raiz, ".sk--foto")).not.toBeNull();
    expect(raiz.innerHTML).not.toMatch(/spinner/i);
  });

  it("mostra o saldo e os 12 prêmios, do menor para o maior custo", async () => {
    const { raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 1.250 pontos");
    expect(qa(raiz, ".card-premio")).toHaveLength(12);
    const custos = custosNaTela(raiz);
    expect(custos).toEqual([...custos].sort((a, b) => a - b));
    expect(texto(card(raiz, "prm_cesta-basica")?.querySelector(".card-premio__custo"))).toBe("1.100 pontos");
    expect(q(raiz, '.aba[aria-current="page"]')?.textContent).toBe("Catálogo");
  });

  it("critério 4 e 9: cada motivo de bloqueio no card, em texto e com ícone", async () => {
    const { raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    const motivos: Array<[string, string, string]> = [
      ["prm_cinema", "Esgotado", "package-x"],
      ["prm_ingresso-show", "Oferta encerrada", "calendar-x"],
      ["prm_bola-futebol", "Disponível a partir do nível 3", "lock"],
      ["prm_kit-hortifruti", "Você já trocou este prêmio 2 vezes este mês", "repeat"],
      ["prm_jogo-panelas", "Faltam 150 pontos", "coins"],
    ];
    for (const [id, motivo, icone] of motivos) {
      const b = card(raiz, id)?.querySelector(".bloqueio");
      expect(texto(b)).toBe(motivo);
      expect(b?.querySelector("svg")?.getAttribute("data-icone")).toBe(icone);
    }
    // Falta saldo: barra do quanto falta.
    expect(card(raiz, "prm_jogo-panelas")?.querySelector(".barra")).not.toBeNull();
    expect(card(raiz, "prm_cinema")?.querySelector(".barra")).toBeNull();
    // Disponível: sem motivo.
    expect(card(raiz, "prm_cafe-regional")?.querySelector(".bloqueio")).toBeNull();
  });

  it("selo de estoque baixo", async () => {
    const { raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    expect(texto(card(raiz, "prm_garrafa-termica")?.querySelector("[data-estoque-baixo]"))).toBe("Últimas 3 unidades");
    expect(texto(card(raiz, "prm_cesta-basica")?.querySelector("[data-estoque-baixo]"))).toBe("Últimas 2 unidades");
    expect(card(raiz, "prm_cafe-regional")?.querySelector("[data-estoque-baixo]")).toBeNull();
  });

  it("fotos com texto alternativo igual ao nome", async () => {
    const { raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    for (const c of qa(raiz, ".card-premio")) {
      expect(c.querySelector("img")?.getAttribute("alt")).toBe(texto(c.querySelector(".card-premio__nome")));
    }
  });

  it("filtro por categoria, atalho 'Posso trocar agora' e ordenação", async () => {
    const { app, raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    await clicar(app, q(raiz, '[data-categoria="lazer"]'));
    expect(qa(raiz, ".card-premio").map((c) => c.dataset.premio)).toEqual(["prm_ingresso-show", "prm_cinema", "prm_bola-futebol"]);
    expect(location.search).toBe("?categoria=lazer");
    expect(q(raiz, '[data-categoria="lazer"]')?.getAttribute("aria-pressed")).toBe("true");

    await clicar(app, q(raiz, '[data-categoria="todas"]'));
    await clicar(app, q(raiz, '[data-atalho="posso-trocar"]'));
    expect(qa(raiz, ".card-premio").length).toBeGreaterThan(0);
    expect(qa(raiz, ".card-premio .bloqueio")).toHaveLength(0);
    expect(texto(q(raiz, ".contagem"))).toMatch(/^\d+ prêmios?$/);

    const sel = q<HTMLSelectElement>(raiz, "#ordem")!;
    sel.value = "maior";
    sel.dispatchEvent(new Event("change"));
    const custos = custosNaTela(raiz);
    expect(custos).toEqual([...custos].sort((a, b) => b - a));
  });

  it("toque no card abre o detalhe", async () => {
    const { app, raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    await clicar(app, card(raiz, "prm_cafe-regional"));
    expect(location.pathname).toBe("/premios/premio/prm_cafe-regional");
    expect(texto(q(raiz, "#titulo-premio"))).toBe("Café regional 500 g");
  });

  it("catálogo vazio", async () => {
    await api.db.query("UPDATE premios SET ativo = false");
    const { raiz } = await montar("/premios/", fetchComo(api, "dev-cidadao-luz"));
    expect(texto(q(raiz, '[data-estado="vazio"]'))).toBe(
      "Nenhum prêmio disponível no momento. Novos prêmios aparecem aqui e no canal Noticias.",
    );
  });

  it("catador: mensagem do Pix, sem catálogo e sem saldo", async () => {
    const { raiz } = await montar("/premios/", fetchComo(api, "dev-catador"));
    expect(texto(q(raiz, '[data-estado="catador"]'))).toBe(
      "Como catador, você recebe o valor das entregas em Pix. Os prêmios são para quem acumula pontos.",
    );
    expect(q(raiz, ".card-premio")).toBeNull();
    expect(q(raiz, ".saldo")).toBeNull();
    expect(q(raiz, ".abas")).toBeNull();
  });
});

describe("erros e offline", () => {
  it("erro de conexão sem dados guardados: mensagem e 'Tentar novamente'", async () => {
    const { app, raiz } = await montar("/premios/", fetchSemRede, { online: false });
    expect(texto(q(raiz, '[data-estado="erro"] .estado__titulo'))).toBe("Sem internet.");
    const tentar = qa(raiz, "button").find((b) => texto(b) === "Tentar novamente");
    expect(tentar).toBeDefined();
    await clicar(app, tentar);
    expect(q(raiz, '[data-estado="erro"]')).not.toBeNull();
  });

  it("erro do servidor: mensagem e 'Tentar novamente', e o erro vai para o Sentry", async () => {
    const quebrado = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const { raiz, reportados } = await montar("/premios/", quebrado);
    expect(texto(q(raiz, '[data-estado="erro"]'))).toMatch(/Tentar novamente/);
    expect(reportados.map((r) => r.contexto.endpoint)).toEqual(["premios"]);
  });

  it("offline: catálogo guardado com 'Sem internet. Dados de [dia e hora]'", async () => {
    const storage = memoria();
    await montar("/premios/", fetchComo(api, "dev-cidadao-luz"), { storage });
    const { raiz } = await montar("/premios/", fetchSemRede, { storage, online: false });
    expect(texto(q(raiz, '[data-estado="offline"] p'))).toBe("Sem internet. Dados de 11/11 às 10:00.");
    expect(qa(raiz, ".card-premio")).toHaveLength(12);
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 1.250 pontos");
  });

  it("o cache é de um usuário só: outra pessoa no mesmo aparelho não vê os dados", async () => {
    const storage = memoria();
    await montar("/premios/", fetchComo(api, "dev-cidadao-luz"), { storage });
    await montar("/premios/", fetchComo(api, "dev-cidadao-novo"), { storage });
    const { raiz } = await montar("/premios/", fetchSemRede, { storage, online: false });
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 300 pontos");
  });
});
