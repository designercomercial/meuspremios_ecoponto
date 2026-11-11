/**
 * Servidor: API + página (apps/web/dist) em /premios/.
 *
 * Banco:
 *   DATABASE_URL=postgres://...   PostgreSQL de verdade (cria as tabelas; com
 *                                 --seed, semeia se estiver vazio)
 *   (sem DATABASE_URL)            PGlite em memória com os dados de exemplo
 *
 * Variáveis e argumentos:
 *   PORT=3000
 *   ECO_DEV_LOGIN=1 / --mocks     entrada /dev para escolher a pessoa (proibido em produção)
 *   ECO_PESSOA=nome / --pessoa=   entra sempre como essa pessoa, sem a tela /dev
 *   ECO_GAMIFICACAO=1 / --gamificacao   liga o nível mínimo ([DEFINIR] Fase 3)
 *   REDIS_URL=redis://...         cache do catálogo no Redis (senão, em memória)
 *   SENTRY_DSN=...                liga o Sentry (eventos limpos de dados pessoais)
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { limparBreadcrumb, limparEvento } from "@ecoponto/observability";
import { buildApp, type Reportar } from "./app.ts";
import { authDeDesenvolvimento, type AuthPort } from "./auth.ts";
import { criarDbPg, criarDbPglite } from "./db/db.ts";
import { migrar, semear, TOKENS_DEV } from "./db/seed.ts";
import { cacheEmMemoria, cacheRedis } from "./premios/cache.ts";
import { criarServico } from "./premios/servico.ts";

const aqui = dirname(fileURLToPath(import.meta.url));
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const porta = Number(process.env.PORT ?? 3000);
const producao = process.env.NODE_ENV === "production";
const pessoaFixa = arg("pessoa") ?? process.env.ECO_PESSOA;
const devLogin = process.env.ECO_DEV_LOGIN === "1" || process.argv.includes("--mocks");
const gamificacaoAtiva = process.env.ECO_GAMIFICACAO === "1" || process.argv.includes("--gamificacao");

if (producao && (devLogin || pessoaFixa)) {
  console.error("Entrada de desenvolvimento (/dev ou pessoa fixa) não pode ser usada em produção.");
  process.exit(1);
}
if (!devLogin && !pessoaFixa) {
  // PENDENTE: como o app SASI entrega a sessão ao canal URL. Ver README.
  console.error("Autenticação do app SASI ainda não definida. Rode com --mocks ou --pessoa=cidadao-luz.");
  process.exit(1);
}

const usuarioFixo = pessoaFixa ? TOKENS_DEV[`dev-${pessoaFixa}`] : undefined;
if (pessoaFixa && !usuarioFixo) {
  const validas = Object.keys(TOKENS_DEV).map((t) => t.replace(/^dev-/, "")).join(", ");
  console.error(`Pessoa "${pessoaFixa}" não existe nos dados de exemplo. Use uma destas: ${validas}.`);
  process.exit(1);
}
const auth: AuthPort = usuarioFixo ? { autenticar: async () => ({ usuarioId: usuarioFixo }) } : authDeDesenvolvimento(TOKENS_DEV);

let reportar: Reportar | undefined;
if (process.env.SENTRY_DSN) {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    beforeSend: (e) => limparEvento(e),
    beforeBreadcrumb: (b) => limparBreadcrumb(b),
  });
  reportar = (erro, contexto) => Sentry.captureException(erro, { tags: contexto });
}

const agora = () => new Date();
const db = process.env.DATABASE_URL ? await criarDbPg(process.env.DATABASE_URL) : await criarDbPglite();
if (db.tipo === "pg") {
  await migrar(db);
  if (process.argv.includes("--seed")) {
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM cidadaos");
    if (rows[0]?.n === 0) await semear(db, agora());
  }
} else {
  await semear(db, agora());
}
const cache = process.env.REDIS_URL ? await cacheRedis(process.env.REDIS_URL) : cacheEmMemoria(agora);

const app = await buildApp({
  auth,
  servico: criarServico({ db, cache, agora, gamificacaoAtiva }),
  devLogin: usuarioFixo ? undefined : { tokens: TOKENS_DEV },
  reportar,
  logger: true,
});
if (usuarioFixo) app.get("/dev", (_req, reply) => reply.redirect("/premios/"));
app.log.info({ banco: db.tipo, cache: process.env.REDIS_URL ? "redis" : "memoria", gamificacaoAtiva, pessoaFixa: pessoaFixa ?? null }, "configuração");

// ---- Página (build do Vite) ----
const dist = resolve(aqui, "../../web/dist");
if (existsSync(dist)) {
  await app.register(fastifyStatic, {
    root: dist,
    prefix: "/premios/",
    preCompressed: true,
    setHeaders(res, caminho) {
      // Arquivos com hash: cache longo. HTML e service worker: sempre revalidar.
      if (/[\\/]assets[\\/]/.test(caminho)) res.header("Cache-Control", "public, max-age=31536000, immutable");
      else res.header("Cache-Control", "no-cache");
    },
  });
  // /premios/vales, /premios/vale/{codigo}... → index.html (a página resolve a rota).
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && /^\/premios(\/|$)/.test(req.url) && !/^\/premios\/(assets|fotos)\//.test(req.url)) {
      reply.header("Cache-Control", "no-cache");
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ erro: "nao_encontrado" });
  });
  app.get("/", (_req, reply) => reply.redirect(usuarioFixo ? "/premios/" : "/dev"));
} else {
  app.log.warn("apps/web/dist não existe: rode `pnpm build` ou use `pnpm dev` (Vite em :5174).");
}

const fechar = async () => {
  await app.close();
  await db.fechar();
  process.exit(0);
};
process.on("SIGINT", fechar);
process.on("SIGTERM", fechar);

await app.listen({ port: porta, host: "127.0.0.1" });
