import "@ecoponto/tokens/tokens.css";
import "./styles.css";
import { criarApp } from "./app.ts";
import { LINKS } from "./config.ts";
import { reportar } from "./report.ts";

function storageSeguro(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem("x");
    return s;
  } catch {
    return null;
  }
}

const raiz = document.getElementById("app");
if (raiz) {
  const app = criarApp({
    raiz,
    fetch: window.fetch.bind(window),
    storage: storageSeguro(),
    online: () => navigator.onLine,
    agora: () => new Date(),
    links: LINKS,
    reportar,
  });
  void app.iniciar();
  window.addEventListener("online", () => void app.mudouConexao());
  window.addEventListener("offline", () => void app.mudouConexao());
}

// ---- Tema claro e escuro (mesmo comportamento da Minha carteirinha) ----
const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const mq = window.matchMedia("(prefers-color-scheme: dark)");
const temaAtual = () => root.dataset.theme ?? (mq.matches ? "dark" : "light");

function atualizarBotao(): void {
  if (!toggle) return;
  const escuro = temaAtual() === "dark";
  toggle.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
  toggle.querySelector<SVGElement>('[data-icon="moon"]')?.toggleAttribute("hidden", escuro);
  toggle.querySelector<SVGElement>('[data-icon="sun"]')?.toggleAttribute("hidden", !escuro);
}

toggle?.addEventListener("click", () => {
  const novo = temaAtual() === "dark" ? "light" : "dark";
  root.dataset.theme = novo;
  try {
    localStorage.setItem("tema", novo);
  } catch {
    /* sem armazenamento: o tema vale só nesta visita */
  }
  atualizarBotao();
});
mq.addEventListener?.("change", atualizarBotao);
atualizarBotao();

// ---- Erros não tratados ----
window.addEventListener("error", (e) => reportar(e.error ?? new Error("erro de script"), { origem: "window.error" }));
window.addEventListener("unhandledrejection", (e) => reportar(e.reason, { origem: "promise" }));

// ---- Offline: service worker só no build ----
if (import.meta.env.MODE === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/premios/sw.js", { scope: "/premios/" }).catch(() => {});
  });
}
