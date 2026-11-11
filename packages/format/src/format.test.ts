import { describe, expect, it } from "vitest";
import { formatData, formatDiaHora, formatDiaMes, formatInteiro, formatPontos, textoStatusVale } from "./index.ts";

describe("números pt-BR", () => {
  it("agrupa milhares com ponto", () => {
    expect(formatInteiro(1250)).toBe("1.250");
    expect(formatInteiro(1_234_567)).toBe("1.234.567");
    expect(formatInteiro(300)).toBe("300");
  });

  it("escreve pontos no singular e no plural", () => {
    expect(formatPontos(1250)).toBe("1.250 pontos");
    expect(formatPontos(1)).toBe("1 ponto");
    expect(formatPontos(0)).toBe("0 pontos");
  });
});

describe("datas em Boa Vista (UTC−4)", () => {
  it("usa o dia de Boa Vista, não o UTC", () => {
    // 02:30 UTC do dia 16 ainda é dia 15 em Boa Vista.
    expect(formatData("2026-12-16T02:30:00Z")).toBe("15/12/2026");
    expect(formatDiaMes("2026-12-16T02:30:00Z")).toBe("15/12");
    expect(formatDiaHora("2026-11-11T18:32:00Z")).toBe("11/11 às 14:32");
  });
});

describe("texto do status do vale", () => {
  it("segue a especificação", () => {
    expect(textoStatusVale({ status: "disponivel", retirada: null })).toBe("Disponível para retirada");
    expect(
      textoStatusVale({ status: "retirado", retirada: { em: "2026-11-03T14:00:00-04:00", ecoponto: "Ecoponto Asa Branca" } }),
    ).toBe("Retirado em 03/11/2026 no Ecoponto Asa Branca");
    expect(textoStatusVale({ status: "cancelado", retirada: null })).toBe("Cancelado. Os pontos voltaram para o seu saldo.");
    expect(textoStatusVale({ status: "vencido", retirada: null })).toBe("Prazo de retirada encerrado");
  });
});
