import { describe, expect, it } from "vitest";
import { REMOVIDO, limparBreadcrumb, limparEvento, limparTexto, limparUrl } from "./index.ts";

describe("limpeza para o Sentry", () => {
  it("remove CPF, e-mail, telefone e valores de mensagens", () => {
    const s = limparTexto(
      "Falha para 123.456.789-09 (maria@exemplo.com, (95) 99123-4567): R$ 86,40 e 1.250 pontos",
    );
    expect(s).not.toMatch(/123\.456/);
    expect(s).not.toMatch(/maria@/);
    expect(s).not.toMatch(/99123/);
    expect(s).not.toMatch(/86,40/);
    expect(s).not.toMatch(/1\.250/);
  });

  it("remove chaves sensíveis em qualquer profundidade", () => {
    const e = limparEvento({
      message: "erro",
      user: { id: "u1", ip_address: "1.2.3.4" },
      extra: {
        nome: "Maria da Silva",
        cpf: "12345678909",
        chavePixMascarada: "***.456.789-**",
        resumo: { saldo: { pontos: 1250 }, cota: { usado: 610 } },
        rota: "historico",
      },
      request: { url: "https://x/api/cidadao/pontos/lancamentos?cursor=abc&mes=2026-11", headers: { cookie: "s" } },
    });
    expect(e.user).toBeUndefined();
    const extra = e.extra as Record<string, unknown>;
    expect(extra.nome).toBe(REMOVIDO);
    expect(extra.cpf).toBe(REMOVIDO);
    expect(extra.chavePixMascarada).toBe(REMOVIDO);
    expect((extra.resumo as Record<string, unknown>).saldo).toBe(REMOVIDO);
    expect(extra.rota).toBe("historico");
    expect(e.request?.url).toBe("https://x/api/cidadao/pontos/lancamentos");
    expect(e.request?.headers).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/Maria|1250|12345678909/);
  });

  it("limpa breadcrumbs de fetch", () => {
    const b = limparBreadcrumb({ category: "fetch", data: { url: "/api/x?cursor=1", total: 99 } });
    expect(b.data).toEqual({ url: "/api/x", total: REMOVIDO });
  });

  it("tira a query string das URLs", () => {
    expect(limparUrl("/pontos/historico?tipo=entregas#x")).toBe("/pontos/historico");
  });

  it("não deixa o código do vale em claro (texto, URL ou chave)", () => {
    expect(limparTexto("Vale ECO-7K3P-9Q não abriu")).toBe("Vale [vale] não abriu");
    expect(limparUrl("/api/cidadao/vales/ECO-7K3P-9Q")).toBe("/api/cidadao/vales/[vale]");
    const e = limparEvento({ extra: { codigo: "ECO-7K3P-9Q", idempotencyKey: "abc", premioId: "prm_1" } });
    const extra = e.extra as Record<string, unknown>;
    expect(extra.codigo).toBe(REMOVIDO);
    expect(extra.idempotencyKey).toBe(REMOVIDO);
    expect(extra.premioId).toBe("prm_1");
  });
});
