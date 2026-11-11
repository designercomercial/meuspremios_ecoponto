/**
 * Gera .vercel/output (Build Output API v3). Roda no build da Vercel (deploy
 * pelo GitHub, ver vercel.json) ou localmente antes de `vercel deploy --prebuilt`.
 *
 *   static/premios/   build do Vite (página, fotos, service worker)
 *   functions/api     API Fastify num único arquivo + arquivos WASM do PGlite
 */
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const saida = resolve(raiz, ".vercel/output");
const rodar = (cmd) => execSync(cmd, { cwd: raiz, stdio: "inherit" });

rmSync(saida, { recursive: true, force: true });

// 1. Página
rodar("pnpm --filter @ecoponto/web build");
cpSync(resolve(raiz, "apps/web/dist"), resolve(saida, "static/premios"), {
  recursive: true,
  // A Vercel comprime sozinha; os .br/.gz do build não são necessários.
  filter: (f) => !/\.(br|gz)$/.test(f),
});

// 2. API
const func = resolve(saida, "functions/api.func");
mkdirSync(func, { recursive: true });
const doApi = createRequire(resolve(raiz, "apps/api/package.json"));
const esbuild = createRequire(resolve(raiz, "package.json"))("esbuild");
await esbuild.build({
  entryPoints: [resolve(raiz, "apps/api/src/vercel.ts")],
  outfile: resolve(func, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  // Opcionais que não usamos (driver nativo do pg).
  external: ["pg-native"],
  // Módulos CommonJS dentro do bundle ESM precisam de require.
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
});
// O PGlite procura os arquivos ao lado do módulo (new URL("./pglite.wasm", import.meta.url)).
const pglite = dirname(doApi.resolve("@electric-sql/pglite")); // …/pglite/dist
for (const f of ["pglite.wasm", "pglite.data", "initdb.wasm"]) copyFileSync(resolve(pglite, f), resolve(func, f));
writeFileSync(
  resolve(func, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 30 }),
);

// 3. Rotas
writeFileSync(
  resolve(saida, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/(dev(/.*)?)?$", status: 307, headers: { Location: "/premios/" } },
        { src: "^/premios$", status: 308, headers: { Location: "/premios/" } },
        { src: "^/premios/assets/(.*)$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "^/premios/(?!assets/).*$", headers: { "Cache-Control": "no-cache" }, continue: true },
        { src: "^/api(/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        // /premios/vales, /premios/vale/{codigo}... → index.html (a página resolve a rota)
        { src: "^/premios/(?!assets/|fotos/).*$", dest: "/premios/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("Pronto: .vercel/output");
