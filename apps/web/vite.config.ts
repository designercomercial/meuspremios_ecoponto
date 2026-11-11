/// <reference types="vitest/config" />
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";

const BASE = "/premios/";

/** Gera /premios/sw.js com a lista de arquivos do build para guardar offline. */
function serviceWorker(): Plugin {
  return {
    name: "eco-service-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      const fotos = readdirSync(fileURLToPath(new URL("./public/fotos", import.meta.url))).map((f) => `${BASE}fotos/${f}`);
      const arquivos = Object.keys(bundle)
        .filter((f) => /\.(js|css|svg|woff2?)$/.test(f) && !f.includes("sentry"))
        .map((f) => BASE + f);
      const versao = arquivos.join("|").length.toString(36) + "-" + Date.now().toString(36);
      const fonte = readFileSync(fileURLToPath(new URL("./sw/sw.js", import.meta.url)), "utf8")
        .replace("__VERSAO__", versao)
        .replace("__PRECACHE__", JSON.stringify([BASE, ...arquivos, ...fotos]));
      this.emitFile({ type: "asset", fileName: "sw.js", source: fonte });
    },
  };
}

/** Gera .br e .gz de cada arquivo de texto; o servidor entrega o menor. */
function preComprimir(): Plugin {
  let saida = "";
  return {
    name: "eco-pre-comprimir",
    apply: "build",
    configResolved(c) {
      saida = c.build.outDir;
    },
    writeBundle() {
      const andar = (dir: string): string[] =>
        readdirSync(dir).flatMap((n) => {
          const p = join(dir, n);
          return statSync(p).isDirectory() ? andar(p) : [p];
        });
      for (const f of andar(saida).filter((p) => /\.(js|css|html|svg)$/.test(p))) {
        const dados = readFileSync(f);
        writeFileSync(`${f}.br`, brotliCompressSync(dados, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${f}.gz`, gzipSync(dados, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [serviceWorker(), preComprimir()],
  build: {
    target: "es2020",
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/dev": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    environmentOptions: { happyDOM: { url: "http://localhost:5174/premios/" } },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
