/**
 * Acesso ao PostgreSQL, com dois adaptadores para o MESMO SQL:
 *
 *  - pg (node-postgres): produção e testes de concorrência (servidor real,
 *    várias conexões ao mesmo tempo).
 *  - PGlite (PostgreSQL em WASM, no próprio processo): desenvolvimento sem
 *    instalar nada e a demonstração na Vercel sem DATABASE_URL.
 *
 * Toda escrita do resgate acontece dentro de `transacao`: se a função lançar
 * erro, tudo é desfeito (ROLLBACK).
 */

export type Linha = Record<string, unknown>;

export interface Executor {
  query<T extends Linha = Linha>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Executor {
  /** BEGIN … COMMIT, ou ROLLBACK se `fn` lançar. Isolamento READ COMMITTED. */
  transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  /** Vários comandos de uma vez, sem parâmetros (migração, seed). */
  executarScript(sql: string): Promise<void>;
  fechar(): Promise<void>;
  readonly tipo: "pg" | "pglite";
}

/** Erro do PostgreSQL com código SQLSTATE (23514 = CHECK, 23505 = único...). */
export function codigoPg(e: unknown): string | null {
  return e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : null;
}

export async function criarDbPg(url: string, max = 10): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max });
  // Conexão ociosa que cai não derruba o processo.
  pool.on("error", () => {});
  return {
    tipo: "pg",
    async query(sql, params) {
      const r = await pool.query(sql, params as unknown[] | undefined);
      return { rows: r.rows };
    },
    async transacao(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const tx: Executor = {
          async query(sql, params) {
            const r = await c.query(sql, params as unknown[] | undefined);
            return { rows: r.rows };
          },
        };
        const out = await fn(tx);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async executarScript(sql) {
      await pool.query(sql);
    },
    async fechar() {
      await pool.end();
    },
  };
}

export async function criarDbPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create();
  const adaptar = (q: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Executor => ({
    async query<T extends Linha>(sql: string, params?: readonly unknown[]) {
      const r = await q.query(sql, params ? [...params] : undefined);
      return { rows: r.rows as T[] };
    },
  });
  return {
    tipo: "pglite",
    ...adaptar(db),
    async transacao(fn) {
      return db.transaction((tx) => fn(adaptar(tx)));
    },
    async executarScript(sql) {
      await db.exec(sql);
    },
    async fechar() {
      await db.close();
    },
  };
}
