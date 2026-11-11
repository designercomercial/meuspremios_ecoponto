/**
 * Função da Vercel (API em /api/*).
 *
 * - Com DATABASE_URL (ex.: Neon): PostgreSQL de verdade. Cria as tabelas e,
 *   se o banco estiver vazio, semeia os dados de exemplo.
 * - Sem DATABASE_URL: DEMONSTRAÇÃO com PGlite em memória. Mesmo SQL e mesma
 *   transação, mas os dados voltam ao inicial a cada partida a frio da função.
 *
 * Autenticação: PENDENTE (sessão do app SASI). Na demonstração, todo visitante
 * entra como a pessoa de exemplo "cidadao-luz" (ECO_PESSOA muda).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./app.ts";
import type { AuthPort } from "./auth.ts";
import { criarDbPg, criarDbPglite } from "./db/db.ts";
import { migrar, semear, TOKENS_DEV } from "./db/seed.ts";
import { cacheEmMemoria, cacheRedis } from "./premios/cache.ts";
import { criarServico } from "./premios/servico.ts";

const pessoa = process.env.ECO_PESSOA ?? "cidadao-luz";
const usuario = TOKENS_DEV[`dev-${pessoa}`];
if (!usuario) throw new Error(`Pessoa de exemplo ${pessoa} não existe.`);
const auth: AuthPort = { autenticar: async () => ({ usuarioId: usuario }) };

const pronto = (async () => {
  const agora = () => new Date();
  const url = process.env.DATABASE_URL;
  const db = url ? await criarDbPg(url, 3) : await criarDbPglite();
  if (url) {
    await migrar(db);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM cidadaos");
    if (rows[0]?.n === 0) await semear(db, agora());
  } else {
    await semear(db, agora());
  }
  const cache = process.env.REDIS_URL ? await cacheRedis(process.env.REDIS_URL) : cacheEmMemoria(agora);
  // Demonstração: gamificação ligada para mostrar o bloqueio por nível (ECO_GAMIFICACAO=0 desliga).
  const gamificacaoAtiva = process.env.ECO_GAMIFICACAO !== "0";
  const app = await buildApp({ auth, servico: criarServico({ db, cache, agora, gamificacaoAtiva }), logger: true });
  await app.ready();
  return app;
})();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await pronto;
  app.server.emit("request", req, res);
}
