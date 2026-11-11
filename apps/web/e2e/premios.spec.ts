/**
 * Ponta a ponta num Chromium de verdade (build de produção + service worker).
 */
import { expect, test, type Page } from "@playwright/test";

async function entrar(page: Page, pessoa = "dev-cidadao-luz", para = "/premios/") {
  await page.goto(`/dev/entrar?como=${pessoa}&para=${encodeURIComponent(para)}`);
}

const semRolagemHorizontal = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("360 px: nenhuma tela tem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await entrar(page);
  for (const url of ["/premios/", "/premios/premio/prm_jogo-panelas", "/premios/vales?filtro=todos", "/premios/vale/ECO-7K3P-9Q", "/premios/vale/ECO-5X2N-8D"]) {
    await page.goto(url);
    await page.locator("main [data-estado], main article, main section").first().waitFor();
    expect(await semRolagemHorizontal(page), url).toBe(true);
  }
});

test("troca completa: confirmação, vale novo com QR, endereço próprio", async ({ page }) => {
  await entrar(page, "dev-cidadao-luz", "/premios/premio/prm_sacola-retornavel");
  await page.getByRole("button", { name: "Trocar por 150 pontos" }).click();
  await expect(page.getByRole("dialog")).toContainText("Trocar 150 pontos por Sacola retornável?");
  await page.getByRole("button", { name: "Confirmar troca" }).click();
  await expect(page).toHaveURL(/\/premios\/vale\/ECO-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}\?novo=1$/);
  await expect(page.getByText("Troca feita. Mostre este vale na portaria de um ecoponto.")).toBeVisible();
  await expect(page.locator(".saldo")).toHaveText("Seu saldo: 1.100 pontos");

  // O endereço abre direto, em outra aba.
  const url = new URL(page.url());
  const outra = await page.context().newPage();
  await outra.goto(url.pathname);
  await expect(outra.getByRole("img", { name: /^QR do vale/ })).toBeVisible();
});

test("QR preto sobre branco também no tema escuro", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await entrar(page, "dev-cidadao-luz", "/premios/vale/ECO-7K3P-9Q");
  const cores = await page.evaluate(() => {
    const css = (sel: string) => getComputedStyle(document.querySelector(sel)!).fill;
    return { modulos: css(".qr__modulos"), fundo: css(".qr__fundo"), pagina: getComputedStyle(document.body).backgroundColor };
  });
  expect(cores.modulos).toBe("rgb(0, 0, 0)");
  expect(cores.fundo).toBe("rgb(255, 255, 255)");
  expect(cores.pagina).not.toBe("rgb(255, 255, 255)");
});

test("critério 8: offline, os vales disponíveis abrem com o QR e a troca fica desabilitada", async ({ page, context }) => {
  await entrar(page, "dev-cidadao-luz", "/premios/vales");
  // (Outro teste pode ter criado mais um vale neste servidor.)
  await expect(page.locator('[data-vale="ECO-9F6H-3W"]')).toBeVisible();
  await page.goto("/premios/premio/prm_cafe-regional");
  await expect(page.getByRole("button", { name: "Trocar por 250 pontos" })).toBeEnabled();
  // Service worker pronto (app shell guardado).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);

  await context.setOffline(true);
  await page.goto("/premios/vale/ECO-9F6H-3W");
  await expect(page.getByRole("img", { name: /^QR do vale/ })).toBeVisible();
  await expect(page.getByText(/^Sem internet\. Dados de/)).toBeVisible();

  await page.goto("/premios/premio/prm_cafe-regional");
  await expect(page.getByRole("button", { name: "Trocar por 250 pontos" })).toBeDisabled();
  await expect(page.getByText("Sem internet. Conecte-se para trocar.")).toBeVisible();
  await context.setOffline(false);
});

test("critério 7: o vale de outro cidadão não abre", async ({ page }) => {
  await entrar(page, "dev-cidadao-novo", "/premios/vale/ECO-7K3P-9Q");
  await expect(page.getByText("Não encontramos este vale.")).toBeVisible();
  await expect(page.locator(".qr")).toHaveCount(0);
});
