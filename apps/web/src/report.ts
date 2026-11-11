/**
 * Envio de erros ao Sentry, sem CPF, nome, código de vale ou valores.
 *
 * O SDK só é baixado se VITE_SENTRY_DSN existir, e depois da primeira tela,
 * para não pesar na abertura (meta: menos de 2 s num Android de entrada).
 */
import { limparBreadcrumb, limparEvento, limparTexto } from "@ecoponto/observability";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

type Sdk = typeof import("@sentry/browser");
let sdk: Promise<Sdk> | null = null;

function carregar(): Promise<Sdk> {
  sdk ??= import("@sentry/browser").then((S) => {
    S.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      // Sem IP, cookies ou dados de requisição.
      beforeSend: (e) => limparEvento(e),
      // URLs perdem a query string (código do vale, filtro) no limpador.
      beforeBreadcrumb: (b) => limparBreadcrumb(b),
    });
    return S;
  });
  return sdk;
}

export function reportar(erro: unknown, contexto: Record<string, string>): void {
  const limpo: Record<string, string> = {};
  for (const [k, v] of Object.entries(contexto)) limpo[k] = limparTexto(v);
  if (!DSN) {
    if (import.meta.env.DEV) console.warn("[reportar]", erro, limpo);
    return;
  }
  void carregar().then((S) => S.captureException(erro, { tags: limpo }));
}
