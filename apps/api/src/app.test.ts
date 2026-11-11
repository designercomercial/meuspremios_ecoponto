/**
 * Rotas HTTP com PGlite (mesmo SQL do PostgreSQL) e os dados de exemplo.
 * Concorrência real fica em resgate.pg.test.ts.
 */
import {
  Catalogo,
  CatalogoCidadao,
  DetalheResposta,
  ListaVales,
  ResgateResposta,
  ValeResposta,
  ValesCidadao,
  type PremioResumo,
} from "@ecoponto/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { AGORA_MOCK, buildAppMock, type AppMock } from "./index.ts";
import { cancelarVale } from "./premios/gestao.ts";

const abertos: AppMock[] = [];
async function app(o: Parameters<typeof buildAppMock>[0] = {}) {
  const a = await buildAppMock({ devLogin: false, ...o });
  abertos.push(a);
  return a;
}
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((a) => a.close()));
});

type Pessoa = "dev-cidadao-luz" | "dev-cidadao-novo" | "dev-catador";
const get = (a: AppMock, url: string, quem: Pessoa = "dev-cidadao-luz") =>
  a.inject({ method: "GET", url, headers: { authorization: `Bearer ${quem}` } });
const resgatar = (a: AppMock, id: string, chave: string | null, quem: Pessoa = "dev-cidadao-luz") =>
  a.inject({
    method: "POST",
    url: `/api/cidadao/premios/${id}/resgatar`,
    headers: { authorization: `Bearer ${quem}`, ...(chave ? { "idempotency-key": chave } : {}) },
  });

const K = (n: number) => `chave-de-teste-${String(n).padStart(8, "0")}`;

async function catalogo(a: AppMock, q = "") {
  const r = await get(a, `/api/cidadao/premios${q}`);
  expect(r.statusCode).toBe(200);
  return CatalogoCidadao.parse(r.json());
}
const por = (lista: PremioResumo[], id: string) => {
  const p = lista.find((x) => x.id === id);
  if (!p) throw new Error(`sem ${id}`);
  return p;
};

describe("autenticação", () => {
  it("sem sessão: 401 em todas as rotas", async () => {
    const a = await app();
    for (const url of ["/api/cidadao/premios", "/api/cidadao/premios/prm_cinema", "/api/cidadao/vales", "/api/cidadao/vales/ECO-7K3P-9Q"]) {
      const r = await a.inject({ method: "GET", url });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ erro: "nao_autenticado" });
    }
    expect((await a.inject({ method: "POST", url: "/api/cidadao/premios/prm_cinema/resgatar" })).statusCode).toBe(401);
  });

  it("respostas de dados pessoais não ficam em cache de proxy", async () => {
    const a = await app();
    expect((await get(a, "/api/cidadao/premios")).headers["cache-control"]).toBe("private, no-store");
  });
});

describe("GET /api/cidadao/premios (critério 4: motivo de bloqueio calculado no servidor)", () => {
  it("12 prêmios, do menor para o maior custo, com o saldo", async () => {
    const c = await catalogo(await app());
    expect(c.saldo).toBe(1250);
    expect(c.premios).toHaveLength(12);
    const custos = c.premios.map((p) => p.custo);
    expect(custos).toEqual([...custos].sort((x, y) => x - y));
  });

  it("cada motivo de bloqueio, com o texto da especificação", async () => {
    const { premios } = await catalogo(await app());
    expect(por(premios, "prm_cinema").bloqueio).toEqual({ codigo: "esgotado", texto: "Esgotado", faltamPontos: null });
    expect(por(premios, "prm_ingresso-show").bloqueio?.texto).toBe("Oferta encerrada");
    expect(por(premios, "prm_bola-futebol").bloqueio?.texto).toBe("Disponível a partir do nível 3");
    expect(por(premios, "prm_kit-hortifruti").bloqueio?.texto).toBe("Você já trocou este prêmio 2 vezes este mês");
    expect(por(premios, "prm_jogo-panelas").bloqueio).toEqual({
      codigo: "saldo_insuficiente",
      texto: "Faltam 150 pontos",
      faltamPontos: 150,
    });
    expect(por(premios, "prm_cesta-basica").bloqueio).toBeNull();
  });

  it("estoque baixo: de 1 a 3 unidades", async () => {
    const { premios } = await catalogo(await app());
    expect(premios.filter((p) => p.estoqueBaixo).map((p) => [p.id, p.estoque])).toEqual([
      ["prm_garrafa-termica", 3],
      ["prm_cesta-basica", 2],
    ]);
  });

  it("filtra por categoria e por 'posso trocar agora'", async () => {
    const a = await app();
    const lazer = await catalogo(a, "?categoria=lazer");
    expect(new Set(lazer.premios.map((p) => p.categoria))).toEqual(new Set(["lazer"]));
    const disp = await catalogo(a, "?disponiveis=true");
    expect(disp.premios.length).toBeGreaterThan(0);
    expect(disp.premios.every((p) => p.bloqueio === null)).toBe(true);
    expect(disp.premios.map((p) => p.id)).not.toContain("prm_cinema");
    expect((await get(a, "/api/cidadao/premios?categoria=carros")).statusCode).toBe(400);
  });

  it("com a gamificação fora do ar, o nível mínimo é ignorado", async () => {
    const { premios } = await catalogo(await app({ gamificacaoAtiva: false }));
    expect(por(premios, "prm_bola-futebol").bloqueio).toBeNull();
  });

  it("catador não vê o catálogo (perfil vem do servidor)", async () => {
    const r = await get(await app(), "/api/cidadao/premios", "dev-catador");
    expect(Catalogo.parse(r.json()).perfil).toBe("catador");
    expect(r.json()).not.toHaveProperty("premios");
  });
});

describe("GET /api/cidadao/premios/{id}", () => {
  it("detalhe com estoque, validade da oferta, onde retirar e prazo de retirada", async () => {
    const r = await get(await app(), "/api/cidadao/premios/prm_cafe-regional");
    expect(r.statusCode).toBe(200);
    const d = DetalheResposta.parse(r.json());
    expect(d.premio).toMatchObject({ nome: "Café regional 500 g", custo: 250, estoque: 60, bloqueio: null });
    expect(d.premio.ofertaAte).not.toBeNull();
    expect(d.premio.ondeRetirar).toMatch(/ecoponto/);
    // 30 dias depois de 11/11, fim do dia em Boa Vista.
    expect(d.premio.retirarAteSeTrocarAgora).toBe("2026-12-12T03:59:59.999Z");
  });

  it("o mesmo motivo de bloqueio do catálogo", async () => {
    const a = await app();
    const { premios } = await catalogo(a);
    for (const p of premios) {
      const d = DetalheResposta.parse((await get(a, `/api/cidadao/premios/${p.id}`)).json());
      expect(d.premio.bloqueio).toEqual(p.bloqueio);
    }
  });

  it("404 para prêmio inexistente ou inválido; 403 para catador", async () => {
    const a = await app();
    expect((await get(a, "/api/cidadao/premios/prm_nao-existe")).statusCode).toBe(404);
    expect((await get(a, "/api/cidadao/premios/DROP TABLE")).statusCode).toBe(404);
    expect((await get(a, "/api/cidadao/premios/prm_cinema", "dev-catador")).json()).toEqual({ erro: "perfil_sem_premios" });
  });
});

describe("POST /api/cidadao/premios/{id}/resgatar", () => {
  it("troca, devolve o vale e o saldo novo", async () => {
    const a = await app();
    const r = await resgatar(a, "prm_cafe-regional", K(1));
    expect(r.statusCode).toBe(201);
    const ok = ResgateResposta.parse(r.json());
    expect(ok.saldo).toBe(1000);
    expect(ok.repetido).toBe(false);
    expect(ok.vale).toMatchObject({ status: "disponivel", custo: 250, premio: { id: "prm_cafe-regional" } });
    expect(ok.vale.codigo).toMatch(/^ECO-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/);
    // O vale abre pelo próprio endereço e o estoque baixou.
    expect((await get(a, `/api/cidadao/vales/${ok.vale.codigo}`)).statusCode).toBe(200);
    expect(por((await catalogo(a)).premios, "prm_cafe-regional").estoque).toBe(59);
  });

  it("critério 3: reenvio com a mesma Idempotency-Key devolve o mesmo vale, sem novo débito", async () => {
    const a = await app();
    const r1 = ResgateResposta.parse((await resgatar(a, "prm_cafe-regional", K(2))).json());
    const r2 = await resgatar(a, "prm_cafe-regional", K(2));
    expect(r2.statusCode).toBe(200);
    const b = ResgateResposta.parse(r2.json());
    expect(b.repetido).toBe(true);
    expect(b.vale.codigo).toBe(r1.vale.codigo);
    expect(b.saldo).toBe(1000);
    expect((await catalogo(a)).saldo).toBe(1000);
  });

  it("sem Idempotency-Key: 400; chave reaproveitada em outro prêmio: 422", async () => {
    const a = await app();
    expect((await resgatar(a, "prm_cafe-regional", null)).json()).toEqual({ erro: "idempotency_key_ausente" });
    expect((await resgatar(a, "prm_cafe-regional", "curta")).statusCode).toBe(400);
    await resgatar(a, "prm_cafe-regional", K(3));
    const r = await resgatar(a, "prm_sacola-retornavel", K(3));
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ erro: "idempotency_key_reutilizada" });
  });

  it("confere de novo cada regra e devolve 409 com o bloqueio atual", async () => {
    const a = await app();
    const casos: Array<[string, string, string]> = [
      ["prm_cinema", "esgotado", "Esgotado"],
      ["prm_ingresso-show", "oferta_encerrada", "Oferta encerrada"],
      ["prm_bola-futebol", "nivel_insuficiente", "Disponível a partir do nível 3"],
      ["prm_kit-hortifruti", "limite_mensal", "Você já trocou este prêmio 2 vezes este mês"],
      ["prm_jogo-panelas", "saldo_insuficiente", "Faltam 150 pontos"],
    ];
    for (const [i, [id, erro, texto]] of casos.entries()) {
      const r = await resgatar(a, id, K(100 + i));
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ erro, bloqueio: { codigo: erro, texto } });
    }
    // Nada foi descontado.
    expect((await catalogo(a)).saldo).toBe(1250);
  });

  it("catador não troca (403); prêmio inexistente (404)", async () => {
    const a = await app();
    expect((await resgatar(a, "prm_cafe-regional", K(5), "dev-catador")).statusCode).toBe(403);
    expect((await resgatar(a, "prm_nao-existe", K(6))).statusCode).toBe(404);
  });

  it("o resgate de um apaga o cache: o estoque esgotado aparece na hora", async () => {
    const a = await app();
    await a.db.query("UPDATE premios SET estoque = 1 WHERE id = 'prm_sacola-retornavel'");
    // ainda em cache (estoque antigo) …
    await catalogo(a);
    expect((await resgatar(a, "prm_sacola-retornavel", K(7))).statusCode).toBe(201);
    expect(por((await catalogo(a)).premios, "prm_sacola-retornavel").bloqueio?.codigo).toBe("esgotado");
  });

  it("log estruturado do resgate, sem código de vale nem usuário", async () => {
    const linhas: string[] = [];
    const a = await app({ logger: { stream: { write: (l: string) => void linhas.push(l) } } });
    const ok = ResgateResposta.parse((await resgatar(a, "prm_cafe-regional", K(8))).json());
    await resgatar(a, "prm_cinema", K(9));
    const logs = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === "resgate");
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ resultado: "sucesso", motivo: null, premio: "prm_cafe-regional" });
    expect(logs[1]).toMatchObject({ resultado: "erro", motivo: "esgotado", premio: "prm_cinema" });
    expect(typeof logs[0]?.duracaoMs).toBe("number");
    const tudo = linhas.join("\n");
    expect(tudo).not.toContain(ok.vale.codigo);
    expect(tudo).not.toContain("u-cidadao-luz");
    expect(tudo).not.toContain(K(8));
  });
});

describe("GET /api/cidadao/vales", () => {
  it("padrão: só os disponíveis; 'todos': os 5, um de cada status", async () => {
    const a = await app();
    const disp = ValesCidadao.parse((await get(a, "/api/cidadao/vales")).json());
    expect(disp.vales.map((v) => v.codigo).sort()).toEqual(["ECO-7K3P-9Q", "ECO-9F6H-3W"]);
    const todos = ValesCidadao.parse((await get(a, "/api/cidadao/vales?status=todos")).json());
    expect(Object.fromEntries(todos.vales.map((v) => [v.codigo, v.status]))).toEqual({
      "ECO-7K3P-9Q": "disponivel",
      "ECO-9F6H-3W": "disponivel",
      "ECO-4M8R-2T": "retirado",
      "ECO-5X2N-8D": "cancelado",
      "ECO-3B7C-6L": "vencido",
    });
  });

  it("destaca o vale que vence em até 7 dias", async () => {
    const { vales } = ValesCidadao.parse((await get(await app(), "/api/cidadao/vales")).json());
    expect(vales.filter((v) => v.venceEmBreve).map((v) => v.codigo)).toEqual(["ECO-9F6H-3W"]);
  });

  it("vale retirado traz onde; vale cancelado traz o estorno no histórico", async () => {
    const { vales } = ValesCidadao.parse((await get(await app(), "/api/cidadao/vales?status=todos")).json());
    const ret = vales.find((v) => v.codigo === "ECO-4M8R-2T");
    expect(ret?.retirada?.ecoponto).toBe("Ecoponto Asa Branca");
    const canc = vales.find((v) => v.codigo === "ECO-5X2N-8D");
    expect(canc?.historico.map((h) => h.evento)).toEqual(["resgatado", "cancelado", "estornado"]);
    expect(canc?.historico.at(-1)?.texto).toBe("450 pontos voltaram para o seu saldo");
  });

  it("cidadão sem vales: lista vazia; catador: perfil catador", async () => {
    const a = await app();
    expect(ValesCidadao.parse((await get(a, "/api/cidadao/vales?status=todos", "dev-cidadao-novo")).json()).vales).toEqual([]);
    expect(ListaVales.parse((await get(a, "/api/cidadao/vales", "dev-catador")).json()).perfil).toBe("catador");
    expect((await get(a, "/api/cidadao/vales?status=qualquer")).statusCode).toBe(400);
  });
});

describe("GET /api/cidadao/vales/{codigo} (critério 7)", () => {
  it("abre o próprio vale, também em minúsculas", async () => {
    const a = await app();
    expect(ValeResposta.parse((await get(a, "/api/cidadao/vales/ECO-7K3P-9Q")).json()).vale.status).toBe("disponivel");
    expect((await get(a, "/api/cidadao/vales/eco-7k3p-9q")).statusCode).toBe(200);
  });

  it("o vale de outro cidadão não abre (mesma resposta de inexistente)", async () => {
    const a = await app();
    const outro = await get(a, "/api/cidadao/vales/ECO-7K3P-9Q", "dev-cidadao-novo");
    const inexistente = await get(a, "/api/cidadao/vales/ECO-2222-22");
    const malformado = await get(a, "/api/cidadao/vales/qualquer-coisa");
    for (const r of [outro, inexistente, malformado]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ erro: "vale_nao_encontrado" });
    }
  });
});

describe("critério 5: prêmio ativado aparece em até 1 minuto (cache de 60 s)", () => {
  it("fica fora enquanto o cache vale e entra depois de 60 s", async () => {
    let agora = new Date(AGORA_MOCK);
    const a = await app({ agora: () => agora });
    await catalogo(a); // enche o cache
    await a.db.query(
      `INSERT INTO premios (id, nome, descricao, foto_url, categoria, custo, estoque, ativo)
       VALUES ('prm_novo', 'Prêmio novo', 'Descrição', '/premios/fotos/sacola-retornavel.svg', 'casa', 100, 10, true)`,
    );
    agora = new Date(agora.getTime() + 30_000);
    expect((await catalogo(a)).premios.map((p) => p.id)).not.toContain("prm_novo");
    agora = new Date(agora.getTime() + 30_001);
    expect((await catalogo(a)).premios.map((p) => p.id)).toContain("prm_novo");
  });

  it("o detalhe não usa cache", async () => {
    const a = await app();
    await catalogo(a);
    await a.db.query("UPDATE premios SET estoque = 7 WHERE id = 'prm_corte-de-cabelo'");
    expect(DetalheResposta.parse((await get(a, "/api/cidadao/premios/prm_corte-de-cabelo")).json()).premio.estoque).toBe(7);
  });
});

describe("critério 6: vale cancelado mostra o status e o estorno vai para o livro-razão", () => {
  it("cancelamento pela gestão devolve os pontos com estorno e registra quem cancelou", async () => {
    const a = await app();
    const ok = ResgateResposta.parse((await resgatar(a, "prm_cafe-regional", K(10))).json());
    expect(ok.saldo).toBe(1000);
    await cancelarVale(a.db, { codigo: ok.vale.codigo, gestor: "gestao:operador-02", em: new Date(AGORA_MOCK) });

    const v = ValeResposta.parse((await get(a, `/api/cidadao/vales/${ok.vale.codigo}`)).json()).vale;
    expect(v.status).toBe("cancelado");
    expect(v.historico.map((h) => h.evento)).toContain("estornado");
    expect((await catalogo(a)).saldo).toBe(1250);

    // O que "Meus Pontos" vai ler: o lançamento de estorno no livro-razão.
    const { rows } = await a.db.query<{ tipo: string; direcao: string; pontos: number; autor: string }>(
      `SELECT l.tipo, l.direcao, l.pontos, l.autor FROM lancamentos l
         JOIN vales v ON v.id = l.vale_id WHERE v.codigo = $1 ORDER BY l.id`,
      [ok.vale.codigo],
    );
    expect(rows).toEqual([
      { tipo: "resgate", direcao: "debito", pontos: 250, autor: null },
      { tipo: "estorno", direcao: "credito", pontos: 250, autor: "gestao:operador-02" },
    ]);
  });
});
