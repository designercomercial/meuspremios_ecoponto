/**
 * Monta a página num DOM de teste ligada à API real com os dados de exemplo
 * (Fastify `inject` + PGlite, sem rede). Assim o que a tela mostra é conferido
 * contra o que a API calcula, não contra valores copiados.
 */
import { buildAppMock, criarDbPglite, type AppMock, type Db } from "@ecoponto/api";
import { criarApp, type App } from "../app.ts";
import type { Links } from "../config.ts";

export const LINKS_TESTE: Links = { faleConosco: "/fale-conosco", meusPontos: "/pontos/" };
export const AGORA = new Date("2026-11-11T10:00:00-04:00");

export type Pessoa = "dev-cidadao-luz" | "dev-cidadao-novo" | "dev-catador";

export type Pedido = { metodo: string; url: string; chave: string | null };

/** Um PGlite por arquivo de teste (criar um leva segundos); zerado a cada teste. */
let dbDoArquivo: Db | null = null;

/** API com os dados de exemplo recém-semeados: cada teste pode mexer no banco à vontade. */
export async function novaApi(): Promise<AppMock> {
  dbDoArquivo ??= await criarDbPglite();
  return buildAppMock({ agora: () => AGORA, devLogin: false, db: dbDoArquivo });
}

/** fetch que chama a API com o token da pessoa e anota cada pedido. */
export function fetchComo(api: AppMock, pessoa: Pessoa, pedidos: Pedido[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const cab = new Headers(init?.headers);
    const metodo = (init?.method ?? "GET").toUpperCase();
    pedidos.push({ metodo, url, chave: cab.get("idempotency-key") });
    const r = await api.inject({
      method: metodo as "GET" | "POST",
      url,
      headers: { authorization: `Bearer ${pessoa}`, ...(cab.get("idempotency-key") ? { "idempotency-key": cab.get("idempotency-key")! } : {}) },
    });
    return new Response(r.body, { status: r.statusCode, headers: { "content-type": String(r.headers["content-type"] ?? "application/json") } });
  }) as typeof fetch;
}

/** fetch de quem está sem internet. */
export const fetchSemRede = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

/** fetch que nunca responde (para ver o skeleton). */
export const fetchPendente = (() => new Promise(() => {})) as unknown as typeof fetch;

export type Montagem = { app: App; raiz: HTMLElement; reportados: Array<{ erro: unknown; contexto: Record<string, string> }> };

export async function montar(
  url: string,
  fetcher: typeof fetch,
  opts: { storage?: Storage | null; online?: boolean | (() => boolean); esperar?: boolean; gerarChave?: () => string } = {},
): Promise<Montagem> {
  history.replaceState(null, "", url);
  document.body.replaceChildren();
  const raiz = document.createElement("div");
  document.body.append(raiz);
  const reportados: Montagem["reportados"] = [];
  const online = typeof opts.online === "function" ? opts.online : () => (opts.online as boolean | undefined) ?? true;
  const app = criarApp({
    raiz,
    fetch: fetcher,
    storage: opts.storage === undefined ? memoria() : opts.storage,
    online,
    agora: () => AGORA,
    links: LINKS_TESTE,
    reportar: (erro, contexto) => reportados.push({ erro, contexto }),
    ...(opts.gerarChave ? { gerarChave: opts.gerarChave } : {}),
  });
  void app.iniciar();
  if (opts.esperar !== false) await app.ocioso();
  else await new Promise((r) => setTimeout(r, 0));
  return { app, raiz, reportados };
}

/** localStorage em memória, para simular "voltar ao app depois". */
export function memoria(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

export const texto = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
export const q = <T extends Element = HTMLElement>(raiz: ParentNode, sel: string) => raiz.querySelector<T>(sel as string) as T | null;
export const qa = (raiz: ParentNode, sel: string) => [...raiz.querySelectorAll<HTMLElement>(sel)];
/** Lista de dados (dl) como "rótulo valor". */
export const pares = (raiz: ParentNode | null) =>
  raiz ? qa(raiz, ".dado").map((d) => `${texto(d.querySelector("dt"))} ${texto(d.querySelector("dd"))}`) : [];

export async function clicar(app: App, el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error("Elemento não encontrado para clicar");
  (el as HTMLElement).click();
  await app.ocioso();
}
