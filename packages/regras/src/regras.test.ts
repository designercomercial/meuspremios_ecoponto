import { CodigoVale } from "@ecoponto/contracts";
import { describe, expect, it } from "vitest";
import {
  avaliarBloqueio,
  estoqueBaixo,
  gerarCodigoVale,
  inicioDoMes,
  prazoRetirada,
  statusEfetivo,
  venceEmBreve,
  type CidadaoParaRegra,
  type PremioParaRegra,
} from "./index.ts";

const AGORA = new Date("2026-11-11T10:00:00-04:00");
const premio = (p: Partial<PremioParaRegra> = {}): PremioParaRegra => ({
  ativo: true,
  custo: 300,
  estoque: 10,
  ofertaAte: null,
  nivelMinimo: null,
  limitePorMes: null,
  ...p,
});
const cidadao = (c: Partial<CidadaoParaRegra> = {}): CidadaoParaRegra => ({ saldo: 1250, nivel: 1, resgatesNoMes: 0, ...c });
const com = { agora: AGORA, gamificacaoAtiva: true };

describe("avaliarBloqueio", () => {
  it("libera quando todas as regras passam", () => {
    expect(avaliarBloqueio(premio(), cidadao(), com)).toBeNull();
  });

  it("esgotado", () => {
    expect(avaliarBloqueio(premio({ estoque: 0 }), cidadao(), com)).toEqual({
      codigo: "esgotado",
      texto: "Esgotado",
      faltamPontos: null,
    });
  });

  it("oferta encerrada (data passada ou prêmio inativo)", () => {
    const venceu = premio({ ofertaAte: new Date("2026-11-10T23:59:59-04:00") });
    expect(avaliarBloqueio(venceu, cidadao(), com)?.texto).toBe("Oferta encerrada");
    expect(avaliarBloqueio(premio({ ativo: false }), cidadao(), com)?.codigo).toBe("oferta_encerrada");
    // Vence hoje mais tarde: ainda vale.
    expect(avaliarBloqueio(premio({ ofertaAte: new Date("2026-11-11T23:59:59-04:00") }), cidadao(), com)).toBeNull();
  });

  it("nível mínimo, só com a gamificação no ar", () => {
    const p = premio({ nivelMinimo: 3 });
    expect(avaliarBloqueio(p, cidadao({ nivel: 2 }), com)?.texto).toBe("Disponível a partir do nível 3");
    expect(avaliarBloqueio(p, cidadao({ nivel: 3 }), com)).toBeNull();
    expect(avaliarBloqueio(p, cidadao({ nivel: 1 }), { ...com, gamificacaoAtiva: false })).toBeNull();
  });

  it("limite do mês", () => {
    const p = premio({ limitePorMes: 2 });
    expect(avaliarBloqueio(p, cidadao({ resgatesNoMes: 2 }), com)?.texto).toBe("Você já trocou este prêmio 2 vezes este mês");
    expect(avaliarBloqueio(premio({ limitePorMes: 1 }), cidadao({ resgatesNoMes: 1 }), com)?.texto).toBe(
      "Você já trocou este prêmio 1 vez este mês",
    );
    expect(avaliarBloqueio(p, cidadao({ resgatesNoMes: 1 }), com)).toBeNull();
  });

  it("saldo insuficiente, com quanto falta", () => {
    expect(avaliarBloqueio(premio({ custo: 1400 }), cidadao({ saldo: 1250 }), com)).toEqual({
      codigo: "saldo_insuficiente",
      texto: "Faltam 150 pontos",
      faltamPontos: 150,
    });
    expect(avaliarBloqueio(premio({ custo: 2251 }), cidadao({ saldo: 1000 }), com)?.texto).toBe("Faltam 1.251 pontos");
    expect(avaliarBloqueio(premio({ custo: 301 }), cidadao({ saldo: 300 }), com)?.texto).toBe("Faltam 1 ponto");
    // Saldo exato: pode trocar.
    expect(avaliarBloqueio(premio({ custo: 1250 }), cidadao({ saldo: 1250 }), com)).toBeNull();
  });

  it("respeita a prioridade quando há mais de um motivo", () => {
    const tudo = premio({ estoque: 0, ofertaAte: new Date("2026-01-01T00:00:00-04:00"), nivelMinimo: 5, custo: 9999 });
    expect(avaliarBloqueio(tudo, cidadao({ saldo: 0 }), com)?.codigo).toBe("esgotado");
    expect(avaliarBloqueio({ ...tudo, estoque: 1 }, cidadao({ saldo: 0 }), com)?.codigo).toBe("oferta_encerrada");
    expect(avaliarBloqueio({ ...tudo, estoque: 1, ofertaAte: null }, cidadao({ saldo: 0 }), com)?.codigo).toBe("nivel_insuficiente");
  });
});

describe("estoque baixo", () => {
  it("de 1 a 3 unidades", () => {
    expect([0, 1, 3, 4].map(estoqueBaixo)).toEqual([false, true, true, false]);
  });
});

describe("datas em Boa Vista", () => {
  it("o mês começa à meia-noite de Boa Vista", () => {
    expect(inicioDoMes(AGORA).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // 01/12 às 02:00 UTC ainda é 30/11 em Boa Vista.
    expect(inicioDoMes(new Date("2026-12-01T02:00:00Z")).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("prazo de retirada: fim do dia, 30 dias depois", () => {
    expect(prazoRetirada(AGORA).toISOString()).toBe("2026-12-12T03:59:59.999Z"); // 11/12 23:59:59 em BV
  });

  it("vale disponível com prazo passado aparece vencido", () => {
    const prazo = new Date("2026-11-10T23:59:59-04:00");
    expect(statusEfetivo("disponivel", prazo, AGORA)).toBe("vencido");
    expect(statusEfetivo("retirado", prazo, AGORA)).toBe("retirado");
    expect(statusEfetivo("disponivel", new Date("2026-11-30T23:59:59-04:00"), AGORA)).toBe("disponivel");
  });

  it("vence em breve: disponível e até 7 dias", () => {
    expect(venceEmBreve("disponivel", new Date("2026-11-18T09:00:00-04:00"), AGORA)).toBe(true);
    expect(venceEmBreve("disponivel", new Date("2026-11-19T10:00:01-04:00"), AGORA)).toBe(false);
    expect(venceEmBreve("retirado", new Date("2026-11-12T00:00:00-04:00"), AGORA)).toBe(false);
  });
});

describe("código do vale", () => {
  it("tem o formato ECO-XXXX-XX e passa no contrato", () => {
    const c = gerarCodigoVale(() => new Uint8Array([0, 1, 2, 3, 30, 31]));
    expect(c).toBe("ECO-2345-YZ");
    expect(CodigoVale.safeParse(c).success).toBe(true);
  });

  it("nunca usa 0, O, 1 ou I", () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoVale((n) => crypto.getRandomValues(new Uint8Array(n)));
      expect(c.slice(4)).not.toMatch(/[01OI]/);
      expect(CodigoVale.safeParse(c).success).toBe(true);
    }
  });
});
