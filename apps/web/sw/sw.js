/*
 * Service worker de Prêmios (gerado no build; ver vite.config.ts).
 *
 * - App shell (HTML, JS, CSS) e fotos dos prêmios: guardados para abrir sem
 *   internet. Navegações em /premios/* tentam a rede e, sem internet, usam o
 *   shell guardado (o vale abre com o QR, gerado no aparelho).
 * - API: NÃO passa por aqui. Os dados ficam no aparelho pela própria página,
 *   separados por usuário e com a data da última atualização.
 */
const VERSAO = "__VERSAO__";
const CACHE = "eco-premios-shell-" + VERSAO;
const PRECACHE = __PRECACHE__;
const SHELL = "/premios/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => n.startsWith("eco-premios-shell-") && n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

const guardar = (req, res) => {
  if (res.ok) {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copia));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && url.pathname.startsWith("/premios")) {
    event.respondWith(
      fetch(req)
        .then((res) => guardar(SHELL, res))
        .catch(() => caches.match(SHELL).then((r) => r || Response.error())),
    );
    return;
  }

  // Arquivos com hash e fotos: cache primeiro.
  if (url.pathname.startsWith("/premios/assets/") || url.pathname.startsWith("/premios/fotos/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => guardar(req, res))));
  }
});
