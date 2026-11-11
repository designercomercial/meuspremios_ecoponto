import { defineConfig, devices } from "@playwright/test";

const PORTA = 3111;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    ...devices["Pixel 5"],
    browserName: "chromium",
    serviceWorkers: "allow",
  },
  webServer: {
    // Build de produção + API com os dados de exemplo servindo /premios/.
    command: "pnpm run build && pnpm --filter @ecoponto/api exec tsx src/server.ts --mocks --gamificacao",
    url: `http://127.0.0.1:${PORTA}/premios/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: String(PORTA), NODE_ENV: "test" },
  },
});
