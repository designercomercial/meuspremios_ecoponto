/**
 * Autenticação da página dentro do webview do app SASI.
 *
 * PENDENTE: como o app SASI entrega a sessão ao canal do tipo URL (cookie,
 * Bearer ou token de troca). Enquanto não estiver definido, a página aceita:
 *   - cookie `eco_sessao`, ou
 *   - cabeçalho `Authorization: Bearer <token>`.
 * O perfil (cidadão ou catador) NUNCA vem do cliente: vem do servidor.
 */
import type { FastifyRequest } from "fastify";

export type Sessao = { usuarioId: string };

export interface AuthPort {
  autenticar(req: FastifyRequest): Promise<Sessao | null>;
}

export const COOKIE_SESSAO = "eco_sessao";

export function extrairToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim() || null;
  const c = (req.cookies as Record<string, string | undefined> | undefined)?.[COOKIE_SESSAO];
  return c ?? null;
}

/** Tokens fixos de desenvolvimento. Só para mocks e testes. */
export function authDeDesenvolvimento(tokens: Readonly<Record<string, string>>): AuthPort {
  return {
    async autenticar(req) {
      const t = extrairToken(req);
      if (!t) return null;
      const usuarioId = Object.hasOwn(tokens, t) ? tokens[t] : undefined;
      return usuarioId ? { usuarioId } : null;
    },
  };
}
