/**
 * Setup global do Vitest: um servidor PostgreSQL de verdade para os testes de
 * concorrência (várias conexões ao mesmo tempo, travas de linha reais).
 *
 * - ECO_PG_TESTE=postgres://usuario:senha@host:porta/banco → usa esse servidor.
 * - Senão, sobe o binário do pacote embedded-postgres numa pasta temporária,
 *   numa porta livre, e apaga tudo no fim.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    pgUrl: string;
  }
}

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

export default async function setup(project: TestProject) {
  if (process.env.ECO_PG_TESTE) {
    project.provide("pgUrl", process.env.ECO_PG_TESTE);
    return;
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pasta = mkdtempSync(join(tmpdir(), "eco-pg-"));
  const porta = await portaLivre();
  const pg = new EmbeddedPostgres({
    databaseDir: pasta,
    user: "postgres",
    password: "teste",
    port: porta,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide("pgUrl", `postgres://postgres:teste@127.0.0.1:${porta}/postgres`);
  return async () => {
    await pg.stop().catch(() => {});
    rmSync(pasta, { recursive: true, force: true });
  };
}
