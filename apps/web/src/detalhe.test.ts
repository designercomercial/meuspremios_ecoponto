/** Telas: detalhe, confirmação, sucesso e erros da troca. */
import type { AppMock } from "@ecoponto/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clicar, fetchComo, fetchSemRede, memoria, montar, novaApi, pares, q, qa, texto, type Pedido } from "./test/ambiente.ts";

let api: AppMock;
beforeEach(async () => {
  api = await novaApi();
});
afterEach(async () => {
  await api.close();
});

const botaoTrocar = (raiz: HTMLElement) => q<HTMLButtonElement>(raiz, "#trocar");
const dialogo = () => document.querySelector<HTMLElement>('[data-dialogo="confirmacao"]');
const caixaErro = (raiz: HTMLElement) => texto(q(raiz, ".caixa--erro"));
let n = 0;
const chaveTeste = () => `chave-tela-${String(++n).padStart(10, "0")}`;

async function abrirConfirmacao(id: string, pedidos: Pedido[] = []) {
  const m = await montar(`/premios/premio/${id}`, fetchComo(api, "dev-cidadao-luz", pedidos), { gerarChave: chaveTeste });
  await clicar(m.app, botaoTrocar(m.raiz));
  return m;
}

describe("detalhe do prêmio", () => {
  it("foto, nome, descrição, custo, estoque, validade da oferta e onde retirar", async () => {
    const { raiz } = await montar("/premios/premio/prm_cafe-regional", fetchComo(api, "dev-cidadao-luz"));
    expect(q(raiz, ".foto--grande img")?.getAttribute("alt")).toBe("Café regional 500 g");
    expect(texto(q(raiz, ".detalhe__custo"))).toBe("250 pontos");
    expect(texto(q(raiz, ".detalhe__descricao"))).toMatch(/café torrado/);
    expect(pares(q(raiz, ".dados"))).toEqual([
      "Estoque 60 unidades",
      "Oferta válida até 21/12/2026",
      "Onde retirar Na portaria de qualquer ecoponto, com o vale aberto no celular.",
    ]);
    const b = botaoTrocar(raiz)!;
    expect(texto(b)).toBe("Trocar por 250 pontos");
    expect(b.disabled).toBe(false);
    // Um único botão principal na tela.
    expect(qa(raiz, ".botao:not(.botao--secundario)")).toHaveLength(1);
  });

  it("critério 4: bloqueado → botão desabilitado com o motivo logo acima", async () => {
    const casos: Array<[string, string]> = [
      ["prm_cinema", "Esgotado"],
      ["prm_ingresso-show", "Oferta encerrada"],
      ["prm_bola-futebol", "Disponível a partir do nível 3"],
      ["prm_kit-hortifruti", "Você já trocou este prêmio 2 vezes este mês"],
      ["prm_jogo-panelas", "Faltam 150 pontos"],
    ];
    for (const [id, motivo] of casos) {
      const { raiz } = await montar(`/premios/premio/${id}`, fetchComo(api, "dev-cidadao-luz"));
      const acao = q(raiz, ".acao")!;
      expect(texto(acao.querySelector("#motivo-bloqueio .bloqueio"))).toBe(motivo);
      expect(acao.querySelector("#motivo-bloqueio svg")).not.toBeNull();
      expect(botaoTrocar(raiz)?.disabled).toBe(true);
      expect(botaoTrocar(raiz)?.getAttribute("aria-describedby")).toBe("motivo-bloqueio");
      // O motivo vem antes do botão.
      expect(acao.firstElementChild?.id).toBe("motivo-bloqueio");
    }
  });

  it("critério 8: sem internet, a troca fica desabilitada", async () => {
    const storage = memoria();
    await montar("/premios/premio/prm_cafe-regional", fetchComo(api, "dev-cidadao-luz"), { storage });
    const { raiz } = await montar("/premios/premio/prm_cafe-regional", fetchSemRede, { storage, online: false });
    expect(texto(q(raiz, '[data-estado="offline"] p'))).toMatch(/^Sem internet\. Dados de/);
    expect(botaoTrocar(raiz)?.disabled).toBe(true);
    expect(texto(q(raiz, '[data-bloqueio="offline"]'))).toBe("Sem internet. Conecte-se para trocar.");
  });

  it("prêmio que saiu do catálogo", async () => {
    const { raiz } = await montar("/premios/premio/prm-nao-existe", fetchComo(api, "dev-cidadao-luz"));
    expect(q(raiz, '[data-estado="nao-encontrado"]')).not.toBeNull();
  });
});

describe("confirmação", () => {
  it("textos do diálogo e foco no 'Confirmar troca'", async () => {
    await abrirConfirmacao("prm_cafe-regional");
    const d = dialogo()!;
    expect(d.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(texto(d.querySelector("#dialogo-titulo"))).toBe("Trocar 250 pontos por Café regional 500 g?");
    expect(qa(d, "#dialogo-texto p").map(texto)).toEqual([
      "Seu saldo vai ficar em 1.000 pontos.",
      "Retire em qualquer ecoponto até 11/12/2026.",
    ]);
    expect(qa(d, "button").map(texto)).toEqual(["Confirmar troca", "Voltar"]);
    expect(document.activeElement?.getAttribute("data-acao")).toBe("confirmar");
  });

  it("'Voltar' fecha sem trocar", async () => {
    const pedidos: Pedido[] = [];
    const { app, raiz } = await abrirConfirmacao("prm_cafe-regional", pedidos);
    await clicar(app, dialogo()?.querySelector('[data-acao="voltar"]'));
    expect(dialogo()).toBeNull();
    expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(0);
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 1.250 pontos");
  });

  it("sucesso: abre o vale novo com a mensagem, o QR e o saldo atualizado", async () => {
    const { app, raiz } = await abrirConfirmacao("prm_cafe-regional");
    await clicar(app, dialogo()?.querySelector('[data-acao="confirmar"]'));
    expect(dialogo()).toBeNull();
    expect(location.pathname).toMatch(/^\/premios\/vale\/ECO-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/);
    expect(texto(q(raiz, ".caixa--sucesso"))).toBe("Troca feita. Mostre este vale na portaria de um ecoponto.");
    expect(q(raiz, ".qr")).not.toBeNull();
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 1.000 pontos");
  });

  it("toque duplo em 'Confirmar troca' gera um único pedido", async () => {
    const pedidos: Pedido[] = [];
    const { app } = await abrirConfirmacao("prm_cafe-regional", pedidos);
    const confirmar = dialogo()?.querySelector<HTMLButtonElement>('[data-acao="confirmar"]');
    confirmar?.click();
    confirmar?.click();
    await app.ocioso();
    expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(1);
  });
});

describe("erros da troca (mensagem clara e lista atualizada)", () => {
  async function confirmarDepois(id: string, mudar: () => Promise<unknown>) {
    const m = await abrirConfirmacao(id);
    await mudar();
    await clicar(m.app, dialogo()?.querySelector('[data-acao="confirmar"]'));
    return m;
  }

  it("esgotou enquanto confirmava", async () => {
    const { raiz } = await confirmarDepois("prm_cesta-basica", () => api.db.query("UPDATE premios SET estoque = 0 WHERE id = 'prm_cesta-basica'"));
    expect(caixaErro(raiz)).toBe("Este prêmio acabou de esgotar.");
    expect(texto(q(raiz, "#motivo-bloqueio"))).toBe("Esgotado");
    expect(botaoTrocar(raiz)?.disabled).toBe(true);
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 1.250 pontos");
  });

  it("o saldo mudou", async () => {
    const { raiz } = await confirmarDepois("prm_cafe-regional", () =>
      api.db.query("UPDATE saldos SET pontos = 100 WHERE usuario_id = 'u-cidadao-luz'"),
    );
    expect(caixaErro(raiz)).toBe("Seu saldo mudou e não é mais suficiente.");
    expect(texto(q(raiz, "#motivo-bloqueio .bloqueio"))).toBe("Faltam 150 pontos");
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 100 pontos");
  });

  it("atingiu o limite do mês", async () => {
    const { raiz } = await confirmarDepois("prm_cafe-regional", async () => {
      await api.inject({
        method: "POST",
        url: "/api/cidadao/premios/prm_cafe-regional/resgatar",
        headers: { authorization: "Bearer dev-cidadao-luz", "idempotency-key": "outro-aparelho-0000001" },
      });
      await api.db.query("UPDATE premios SET limite_por_mes = 1 WHERE id = 'prm_cafe-regional'");
    });
    expect(caixaErro(raiz)).toBe("Você atingiu o limite deste prêmio no mês.");
    expect(texto(q(raiz, "#motivo-bloqueio"))).toBe("Você já trocou este prêmio 1 vez este mês");
  });

  it("falha de rede: mensagem genérica, e a nova tentativa usa a MESMA chave (sem débito duplo)", async () => {
    const pedidos: Pedido[] = [];
    const real = fetchComo(api, "dev-cidadao-luz", pedidos);
    let derrubar = true;
    // A troca chega ao servidor, mas a resposta se perde na rede.
    const instavel = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await real(input, init);
      if (init?.method === "POST" && derrubar) {
        derrubar = false;
        throw new TypeError("Failed to fetch");
      }
      return r;
    }) as typeof fetch;

    const { app, raiz } = await montar("/premios/premio/prm_cafe-regional", instavel, { gerarChave: chaveTeste });
    await clicar(app, botaoTrocar(raiz));
    await clicar(app, dialogo()?.querySelector('[data-acao="confirmar"]'));
    expect(caixaErro(raiz)).toBe("Não foi possível concluir a troca. Seus pontos não foram descontados. Tente de novo.");

    await clicar(app, botaoTrocar(raiz));
    await clicar(app, dialogo()?.querySelector('[data-acao="confirmar"]'));
    const posts = pedidos.filter((p) => p.metodo === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.chave).toBe(posts[1]?.chave);
    expect(location.pathname).toMatch(/^\/premios\/vale\//);
    // Um só débito: 1.250 − 250.
    expect(texto(q(raiz, ".saldo"))).toBe("Seu saldo: 1.000 pontos");
  });
});
