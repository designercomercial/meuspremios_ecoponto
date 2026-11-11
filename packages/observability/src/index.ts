/**
 * Limpeza de eventos antes de ir para o Sentry (web e API).
 *
 * Regra: nenhum CPF, nome, chave Pix, código de vale ou valor (pontos, reais,
 * saldo) em claro.
 * Use como `beforeSend` e `beforeBreadcrumb`. Funciona com objetos simples,
 * então é testável sem o SDK do Sentry.
 */

export const REMOVIDO = "[removido]";

/** Chaves cujo conteúdo nunca sai do aparelho/servidor. */
const CHAVES_SENSIVEIS =
  /cpf|nome|name|chave|pix|codigo|vale|idempot|saldo|pontos|centavos|valor|value|total|recebido|doado|cota|limite|usado|restante|benefici|email|telefone|phone|cookie|authorization|token|sessao|session|usuario|user|ip_address/i;

/** Chaves técnicas que podemos manter mesmo batendo no padrão acima. */
const CHAVES_PERMITIDAS = new Set(["type", "level", "event_id", "platform", "environment", "release"]);

const PADROES: ReadonlyArray<[RegExp, string]> = [
  // Código do vale: ECO-7K3P-9Q (dá direito a retirar um prêmio)
  [/\bECO-[0-9A-Z]{4}-[0-9A-Z]{2}\b/gi, "[vale]"],
  // CPF com ou sem máscara: 123.456.789-09 / 12345678909
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]"],
  // CNPJ
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj]"],
  // E-mail
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  // Telefone BR: (95) 99123-4567, +55 95 991234567
  [/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "[telefone]"],
  // Chave aleatória do Pix (UUID)
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  // Dinheiro: R$ 86,40
  [/R\$\s?\d[\d.]*(,\d{2})?/g, "[valor]"],
  // Pontos: 1.250 pontos, +120 pontos, −300 pontos
  [/[+−-]?\s?\d[\d.]*\s?pontos?\b/gi, "[valor]"],
];

export function limparTexto(s: string): string {
  let out = s;
  for (const [re, sub] of PADROES) out = out.replace(re, sub);
  return out;
}

/** Remove a query string de uma URL (pode ter cursor, mês ou token). */
export function limparUrl(url: string): string {
  const i = url.search(/[?#]/);
  return limparTexto(i === -1 ? url : url.slice(0, i));
}

function limpar(v: unknown, prof: number): unknown {
  if (prof > 8) return REMOVIDO;
  if (typeof v === "string") return limparTexto(v);
  if (Array.isArray(v)) return v.map((x) => limpar(x, prof + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "url" && typeof x === "string") out[k] = limparUrl(x);
      else if (!CHAVES_PERMITIDAS.has(k) && CHAVES_SENSIVEIS.test(k)) out[k] = REMOVIDO;
      else out[k] = limpar(x, prof + 1);
    }
    return out;
  }
  return v;
}

type EventoLike = {
  user?: unknown;
  request?: { headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown; url?: string };
};

/** `beforeSend` do Sentry. Aceita qualquer evento (tipo do SDK preservado). */
export function limparEvento<T extends object>(evento: T): T {
  const e = limpar(evento, 0) as EventoLike;
  // Sem identificação de usuário nem corpo de requisição.
  delete e.user;
  if (e.request) {
    delete e.request.headers;
    delete e.request.cookies;
    delete e.request.data;
    delete e.request.query_string;
  }
  return e as T;
}

/** `beforeBreadcrumb` do Sentry: corta dados de fetch/xhr e limpa mensagens. */
export function limparBreadcrumb<T extends { data?: unknown; message?: string }>(b: T): T {
  return limpar(b, 0) as T;
}

/** Contexto seguro para reportar um erro de contrato (só caminho e código). */
export function resumoErroDeContrato(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>,
): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".")}:${i.code}`)
    .join(", ");
}
