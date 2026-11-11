import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Sobe um PostgreSQL de verdade (embedded-postgres) para os testes de
    // concorrência. Com ECO_PG_TESTE=postgres://..., usa esse servidor.
    globalSetup: ["./src/test/pg-global.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
