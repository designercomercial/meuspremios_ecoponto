/**
 * Dados de exemplo (mock) para desenvolvimento, demonstração e testes de tela.
 *
 * As datas são relativas a `agora`, para os estados continuarem certos em
 * qualquer dia (vale que vence em 5 dias, limite do mês atingido...).
 *
 * Pessoas:
 *  - cidadao-luz   saldo 1.250, nível 2, 5 vales (disponível, disponível
 *                  vencendo, retirado, cancelado com estorno, vencido) e o
 *                  limite do "Kit hortifrúti" atingido no mês
 *  - cidadao-novo  saldo 300, nenhum vale
 *  - catador       recebe em Pix; não troca prêmios
 *
 * 12 prêmios: estoque baixo (2 e 3 unidades), 1 esgotado, 1 com oferta
 * encerrada, 1 com nível mínimo, 1 com limite mensal atingido, 1 caro demais.
 */
import { inicioDoMes, prazoRetirada } from "@ecoponto/regras";
import { lancar } from "../ledger/ledger.ts";
import { cancelarVale, retirarVale } from "../premios/gestao.ts";
import type { Db } from "./db.ts";
import { SCHEMA_SQL } from "./schema.ts";

export const TOKENS_DEV: Readonly<Record<string, string>> = {
  "dev-cidadao-luz": "u-cidadao-luz",
  "dev-cidadao-novo": "u-cidadao-novo",
  "dev-catador": "u-catador",
};

const DIA = 86_400_000;

type PremioSeed = {
  id: string;
  nome: string;
  descricao: string;
  categoria: "alimentacao" | "casa" | "lazer" | "servicos";
  custo: number;
  estoque: number;
  limitePorMes?: number;
  nivelMinimo?: number;
  /** Dias a partir de agora (negativo = já passou). */
  ofertaEmDias?: number;
};

const foto = (id: string) => `/premios/fotos/${id.replace(/^prm_/, "")}.svg`;

export const PREMIOS_SEED: readonly PremioSeed[] = [
  {
    id: "prm_sacola-retornavel",
    nome: "Sacola retornável",
    descricao: "Sacola de lona reforçada, lavável, para as compras da semana. Feita por cooperativa de Boa Vista.",
    categoria: "casa",
    custo: 150,
    estoque: 120,
  },
  {
    id: "prm_cafe-regional",
    nome: "Café regional 500 g",
    descricao: "Pacote de café torrado e moído, produzido em Roraima.",
    categoria: "alimentacao",
    custo: 250,
    estoque: 60,
    ofertaEmDias: 40,
  },
  {
    id: "prm_kit-hortifruti",
    nome: "Kit hortifrúti da feira",
    descricao: "Cesta com verduras, legumes e frutas da época, montada pela Feira do Produtor.",
    categoria: "alimentacao",
    custo: 300,
    estoque: 40,
    limitePorMes: 2,
  },
  {
    id: "prm_corte-de-cabelo",
    nome: "Corte de cabelo",
    descricao: "Um corte de cabelo em salão parceiro do programa. Agende pelo telefone que vem no vale retirado.",
    categoria: "servicos",
    custo: 400,
    estoque: 20,
  },
  {
    id: "prm_garrafa-termica",
    nome: "Garrafa térmica 1 L",
    descricao: "Garrafa térmica de aço inox, mantém a água gelada por até 12 horas.",
    categoria: "casa",
    custo: 450,
    estoque: 3,
  },
  {
    id: "prm_ingresso-show",
    nome: "Ingresso do show de aniversário da cidade",
    descricao: "Ingresso para a área reservada do show de aniversário de Boa Vista.",
    categoria: "lazer",
    custo: 500,
    estoque: 30,
    ofertaEmDias: -1,
  },
  {
    id: "prm_lampadas-led",
    nome: "Kit 4 lâmpadas LED",
    descricao: "Quatro lâmpadas LED de 9 W, que gastam até 80% menos energia que as comuns.",
    categoria: "casa",
    custo: 600,
    estoque: 15,
  },
  {
    id: "prm_revisao-bicicleta",
    nome: "Revisão de bicicleta",
    descricao: "Revisão completa (freios, câmbio, pneus e lubrificação) em oficina parceira.",
    categoria: "servicos",
    custo: 650,
    estoque: 8,
  },
  {
    id: "prm_cinema",
    nome: "Sessão de cinema para 2",
    descricao: "Dois ingressos para qualquer sessão de segunda a quinta, em cinema parceiro.",
    categoria: "lazer",
    custo: 700,
    estoque: 0,
  },
  {
    id: "prm_bola-futebol",
    nome: "Bola de futebol oficial",
    descricao: "Bola de futebol de campo, tamanho oficial. Prêmio para quem já chegou ao nível 3.",
    categoria: "lazer",
    custo: 800,
    estoque: 12,
    nivelMinimo: 3,
  },
  {
    id: "prm_cesta-basica",
    nome: "Cesta básica",
    descricao: "Cesta com arroz, feijão, óleo, açúcar, café, macarrão, farinha e leite em pó.",
    categoria: "alimentacao",
    custo: 1100,
    estoque: 2,
  },
  {
    id: "prm_jogo-panelas",
    nome: "Jogo de panelas antiaderentes",
    descricao: "Cinco panelas antiaderentes com tampa de vidro.",
    categoria: "casa",
    custo: 1400, // saldo 1.250: "Faltam 150 pontos"
    estoque: 5,
  },
];

/** Cria as tabelas (idempotente). */
export async function migrar(db: Db): Promise<void> {
  await db.executarScript(SCHEMA_SQL);
}

/** Apaga tudo e semeia de novo (testes reaproveitam o mesmo banco). */
export async function ressemear(db: Db, agora: Date): Promise<void> {
  await migrar(db);
  await db.executarScript(
    "TRUNCATE resgate_idempotencia, lancamentos, vales, saldos, premios, cidadaos RESTART IDENTITY CASCADE",
  );
  await semear(db, agora);
}

/** Cria tabelas e dados de exemplo num banco VAZIO. */
export async function semear(db: Db, agora: Date): Promise<void> {
  await migrar(db);
  const t = (dias: number) => new Date(agora.getTime() + dias * DIA);

  await db.query(
    `INSERT INTO cidadaos (id, ref, perfil, nivel) VALUES
       ('u-cidadao-luz', 'ref-k8Qm2xLu', 'cidadao', 2),
       ('u-cidadao-novo', 'ref-p3Vn7tNo', 'cidadao', 1),
       ('u-catador', 'ref-c9Tz4rCa', 'catador', 1)`,
  );

  for (const p of PREMIOS_SEED) {
    await db.query(
      `INSERT INTO premios (id, nome, descricao, foto_url, categoria, custo, estoque, limite_por_mes, nivel_minimo, oferta_ate, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      [
        p.id,
        p.nome,
        p.descricao,
        foto(p.id),
        p.categoria,
        p.custo,
        p.estoque,
        p.limitePorMes ?? null,
        p.nivelMinimo ?? null,
        p.ofertaEmDias === undefined ? null : t(p.ofertaEmDias),
      ],
    );
  }

  const u = "u-cidadao-luz";
  // Vale direto no banco, com data controlada (o resgate de verdade usa o relógio).
  const vale = async (codigo: string, premioId: string, custo: number, em: Date) => {
    const id = `vale-${codigo}`;
    await db.query(
      `INSERT INTO vales (id, codigo, usuario_id, premio_id, custo, status, resgatado_em, retirar_ate)
       VALUES ($1, $2, $3, $4, $5, 'disponivel', $6, $7)`,
      [id, codigo, u, premioId, custo, em, prazoRetirada(em)],
    );
    await db.transacao((tx) => lancar(tx, { usuarioId: u, tipo: "resgate", pontos: custo, descricao: "Troca de prêmio", em, valeId: id }));
  };
  const credito = (tipo: "entrega" | "bonus_campanha", pontos: number, descricao: string, em: Date) =>
    db.transacao((tx) => lancar(tx, { usuarioId: u, tipo, pontos, descricao, em }));

  // Em ordem cronológica: o saldo nunca fica negativo no caminho.
  const inicio = inicioDoMes(agora).getTime();
  const noMes = (fracao: number) => new Date(inicio + (agora.getTime() - inicio) * fracao);

  await credito("entrega", 980, "Entrega no Ecoponto Asa Branca", t(-80));
  await credito("entrega", 760, "Entrega no Ecoponto Pricumã", t(-60));
  await credito("bonus_campanha", 300, "Bônus da campanha Recicla Boa Vista", t(-50));
  await vale("ECO-3B7C-6L", "prm_sacola-retornavel", 150, t(-45)); // vai vencer
  await credito("entrega", 610, "Entrega no Ecoponto Asa Branca", t(-40));
  await vale("ECO-9F6H-3W", "prm_revisao-bicicleta", 650, t(-25)); // vence em 5 dias
  await vale("ECO-5X2N-8D", "prm_garrafa-termica", 450, t(-22)); // será cancelado
  await cancelarVale(db, { codigo: "ECO-5X2N-8D", gestor: "gestao:operador-07", em: t(-18) });
  await vale("ECO-4M8R-2T", "prm_kit-hortifruti", 300, noMes(0.25)); // retirado, conta no limite
  await retirarVale(db, { codigo: "ECO-4M8R-2T", ecoponto: "Ecoponto Asa Branca", atendente: "portaria:asa-branca", em: noMes(0.5) });
  await vale("ECO-7K3P-9Q", "prm_kit-hortifruti", 300, noMes(0.75)); // disponível, 2º do mês

  // O cancelamento devolveu uma garrafa ao estoque; o mock quer 3 unidades.
  await db.query("UPDATE premios SET estoque = 3 WHERE id = 'prm_garrafa-termica'");

  await db.transacao((tx) =>
    lancar(tx, { usuarioId: "u-cidadao-novo", tipo: "entrega", pontos: 300, descricao: "Entrega no Ecoponto Pricumã", em: t(-3) }),
  );
}
