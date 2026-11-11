export { buildApp, type OpcoesApp, type Reportar } from "./app.ts";
export { authDeDesenvolvimento, COOKIE_SESSAO, type AuthPort } from "./auth.ts";
export { criarDbPg, criarDbPglite, type Db } from "./db/db.ts";
export { migrar, ressemear, semear, PREMIOS_SEED, TOKENS_DEV } from "./db/seed.ts";
export { cacheEmMemoria, cacheRedis, TTL_CATALOGO_MS, type CacheCatalogo } from "./premios/cache.ts";
export { cancelarVale, retirarVale } from "./premios/gestao.ts";
export { criarServico, type ServicoPremios } from "./premios/servico.ts";
export type { FastifyInstance } from "fastify";

import { authDeDesenvolvimento, type AuthPort } from "./auth.ts";
import { buildApp, type OpcoesApp } from "./app.ts";
import { criarDbPglite, type Db } from "./db/db.ts";
import { ressemear, semear, TOKENS_DEV } from "./db/seed.ts";
import { cacheEmMemoria } from "./premios/cache.ts";
import { criarServico } from "./premios/servico.ts";

/** Data de referência dos mocks em testes. */
export const AGORA_MOCK = "2026-11-11T10:00:00-04:00";

export type AppMock = Awaited<ReturnType<typeof buildApp>> & { db: Db };

/**
 * App com PGlite em memória, dados de exemplo e relógio fixo.
 * Usado nos testes da API e das telas, no `pnpm dev` e na demonstração.
 */
export async function buildAppMock(
  o: {
    agora?: () => Date;
    gamificacaoAtiva?: boolean;
    auth?: AuthPort;
    devLogin?: boolean;
    /** Banco já criado (os testes reaproveitam um por arquivo; não é fechado aqui). */
    db?: Db;
  } & Pick<OpcoesApp, "logger" | "reportar"> = {},
): Promise<AppMock> {
  const agora = o.agora ?? (() => new Date(AGORA_MOCK));
  const proprio = !o.db;
  const db = o.db ?? (await criarDbPglite());
  await (proprio ? semear(db, agora()) : ressemear(db, agora()));
  const servico = criarServico({ db, cache: cacheEmMemoria(agora), agora, gamificacaoAtiva: o.gamificacaoAtiva ?? true });
  const app = await buildApp({
    auth: o.auth ?? authDeDesenvolvimento(TOKENS_DEV),
    servico,
    devLogin: o.devLogin === false ? undefined : { tokens: TOKENS_DEV },
    logger: o.logger,
    reportar: o.reportar,
  });
  if (proprio) app.addHook("onClose", () => db.fechar());
  return Object.assign(app, { db });
}
