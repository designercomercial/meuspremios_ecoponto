/**
 * Contratos da página "Prêmios".
 *
 * Compartilhados entre a API (valida o que sai) e a web (valida o que chega).
 * Todo valor é calculado no servidor, inclusive o motivo de bloqueio de cada
 * prêmio para o cidadão da sessão. A página só exibe.
 *
 * Usa zod/mini, como Meus Pontos: mesma validação com bundle menor.
 */
import * as z from "zod/mini";

/** Qualquer esquema que valide e devolva T. */
export type Esquema<T> = {
  safeParse(dados: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }> } };
};

// ---------------------------------------------------------------------------
// Básicos
// ---------------------------------------------------------------------------

export const Perfil = z.enum(["cidadao", "catador"]);
export type Perfil = z.infer<typeof Perfil>;

/** Data e hora com fuso (ISO 8601). */
export const DataHora = z.iso.datetime({ offset: true });

const Inteiro = z.int().check(z.nonnegative());
const Positivo = z.int().check(z.positive());
const Texto = z.string().check(z.minLength(1));

/** [DEFINIR] Categorias do catálogo. Padrão adotado: estas quatro. */
export const CATEGORIAS = ["alimentacao", "casa", "lazer", "servicos"] as const;
export const Categoria = z.enum(CATEGORIAS);
export type Categoria = z.infer<typeof Categoria>;

/** Alfabeto do código do vale: sem 0/O e 1/I, para o atendente não confundir. */
export const ALFABETO_VALE = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** ECO-7K3P-9Q */
export const CodigoVale = z
  .string()
  .check(z.regex(/^ECO-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/, "Código de vale inválido"));
export type CodigoVale = z.infer<typeof CodigoVale>;

export const IdPremio = z.string().check(z.regex(/^prm_[a-z0-9-]{1,40}$/, "Prêmio inválido"));

/** Chave de idempotência do resgate (UUID gerado no aparelho). */
export const IdempotencyKey = z.string().check(z.regex(/^[A-Za-z0-9_-]{16,80}$/, "Chave inválida"));

// ---------------------------------------------------------------------------
// Bloqueio (calculado no servidor)
// ---------------------------------------------------------------------------

/** Na ordem de prioridade: se mais de um vale, aparece o primeiro. */
export const CodigoBloqueio = z.enum([
  "esgotado",
  "oferta_encerrada",
  "nivel_insuficiente",
  "limite_mensal",
  "saldo_insuficiente",
]);
export type CodigoBloqueio = z.infer<typeof CodigoBloqueio>;

export const Bloqueio = z.object({
  codigo: CodigoBloqueio,
  /** Texto pronto: "Faltam 150 pontos", "Disponível a partir do nível 3"... */
  texto: Texto,
  /** Só em saldo_insuficiente: quanto falta (para a barra). */
  faltamPontos: z.nullable(Positivo),
});
export type Bloqueio = z.infer<typeof Bloqueio>;

// ---------------------------------------------------------------------------
// Prêmios
// ---------------------------------------------------------------------------

export const PremioResumo = z.object({
  id: IdPremio,
  nome: Texto,
  /** Foto com proporção fixa; o texto alternativo é o nome. */
  fotoUrl: Texto,
  categoria: Categoria,
  custo: Positivo,
  estoque: Inteiro,
  /** Estoque entre 1 e 3: selo "Últimas 3 unidades". */
  estoqueBaixo: z.boolean(),
  bloqueio: z.nullable(Bloqueio),
});
export type PremioResumo = z.infer<typeof PremioResumo>;

export const PremioDetalhe = z.extend(PremioResumo, {
  descricao: Texto,
  /** Fim da oferta. null = sem data. */
  ofertaAte: z.nullable(DataHora),
  ondeRetirar: Texto,
  limitePorMes: z.nullable(Positivo),
  /** null quando não há nível mínimo ou a gamificação não está no ar. */
  nivelMinimo: z.nullable(Positivo),
  /** Prazo de retirada se trocar agora. */
  retirarAteSeTrocarAgora: DataHora,
});
export type PremioDetalhe = z.infer<typeof PremioDetalhe>;

const Cabecalho = {
  /** Identificador opaco do usuário, só para separar o cache no aparelho. */
  usuarioRef: z.string().check(z.minLength(8)),
  atualizadoEm: DataHora,
};

/** Catador não troca prêmios ([DEFINIR]); a página mostra o aviso do Pix. */
export const SemPremiosCatador = z.object({ perfil: z.literal("catador"), ...Cabecalho });
export type SemPremiosCatador = z.infer<typeof SemPremiosCatador>;

export const CatalogoCidadao = z.object({
  perfil: z.literal("cidadao"),
  ...Cabecalho,
  /** Soma do livro-razão (T24). Nunca negativo. */
  saldo: Inteiro,
  premios: z.array(PremioResumo),
});
export type CatalogoCidadao = z.infer<typeof CatalogoCidadao>;

export const Catalogo = z.discriminatedUnion("perfil", [CatalogoCidadao, SemPremiosCatador]);
export type Catalogo = z.infer<typeof Catalogo>;

export const DetalheResposta = z.object({
  perfil: z.literal("cidadao"),
  ...Cabecalho,
  saldo: Inteiro,
  premio: PremioDetalhe,
});
export type DetalheResposta = z.infer<typeof DetalheResposta>;

const Booleano = z.enum(["true", "false", "1", "0"]);
export const CatalogoQuery = z.object({
  categoria: z.optional(Categoria),
  disponiveis: z.optional(Booleano),
});

// ---------------------------------------------------------------------------
// Vales
// ---------------------------------------------------------------------------

export const StatusVale = z.enum(["disponivel", "retirado", "cancelado", "vencido"]);
export type StatusVale = z.infer<typeof StatusVale>;

export const EventoVale = z.enum(["resgatado", "retirado", "cancelado", "estornado", "vencido"]);
export type EventoVale = z.infer<typeof EventoVale>;

export const Vale = z
  .object({
    codigo: CodigoVale,
    premio: z.object({ id: IdPremio, nome: Texto, fotoUrl: Texto }),
    custo: Positivo,
    resgatadoEm: DataHora,
    retirarAte: DataHora,
    /** Status efetivo: um vale "disponível" com prazo passado vem como "vencido". */
    status: StatusVale,
    /** Disponível e vence em até 7 dias. */
    venceEmBreve: z.boolean(),
    retirada: z.nullable(z.object({ em: DataHora, ecoponto: Texto })),
    cancelamento: z.nullable(z.object({ em: DataHora })),
    historico: z.array(z.object({ evento: EventoVale, em: DataHora, texto: Texto })),
  })
  .check(
    z.superRefine((v, ctx) => {
      if ((v.status === "retirado") !== (v.retirada !== null)) {
        ctx.addIssue({ code: "custom", path: ["retirada"], message: "Retirada só em vale retirado", input: v.retirada });
      }
      if ((v.status === "cancelado") !== (v.cancelamento !== null)) {
        ctx.addIssue({ code: "custom", path: ["cancelamento"], message: "Cancelamento só em vale cancelado", input: v.cancelamento });
      }
      if (v.venceEmBreve && v.status !== "disponivel") {
        ctx.addIssue({ code: "custom", path: ["venceEmBreve"], message: "Só vale disponível vence", input: v.venceEmBreve });
      }
    }),
  );
export type Vale = z.infer<typeof Vale>;

export const ValesCidadao = z.object({
  perfil: z.literal("cidadao"),
  ...Cabecalho,
  saldo: Inteiro,
  vales: z.array(Vale),
});
export type ValesCidadao = z.infer<typeof ValesCidadao>;

export const ListaVales = z.discriminatedUnion("perfil", [ValesCidadao, SemPremiosCatador]);
export type ListaVales = z.infer<typeof ListaVales>;

export const FiltroVales = z.enum(["disponiveis", "todos"]);
export type FiltroVales = z.infer<typeof FiltroVales>;

export const ValesQuery = z.object({ status: z.optional(FiltroVales) });

export const ValeResposta = z.object({ ...Cabecalho, vale: Vale });
export type ValeResposta = z.infer<typeof ValeResposta>;

// ---------------------------------------------------------------------------
// Resgate
// ---------------------------------------------------------------------------

export const ResgateResposta = z.object({
  vale: Vale,
  /** Saldo depois do débito. */
  saldo: Inteiro,
  /** true quando a mesma Idempotency-Key já tinha gerado este vale. */
  repetido: z.boolean(),
});
export type ResgateResposta = z.infer<typeof ResgateResposta>;

export const CodigoErro = z.enum([
  "nao_autenticado",
  "parametro_invalido",
  "premio_nao_encontrado",
  "vale_nao_encontrado",
  "perfil_sem_premios",
  "idempotency_key_ausente",
  "idempotency_key_reutilizada",
  "esgotado",
  "oferta_encerrada",
  "nivel_insuficiente",
  "limite_mensal",
  "saldo_insuficiente",
  "interno",
]);
export type CodigoErro = z.infer<typeof CodigoErro>;

export const RespostaErro = z.object({
  erro: CodigoErro,
  /** Nos erros de regra: o bloqueio atual, para a tela atualizar. */
  bloqueio: z.optional(z.nullable(Bloqueio)),
});
export type RespostaErro = z.infer<typeof RespostaErro>;
