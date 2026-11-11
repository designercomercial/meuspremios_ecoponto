/**
 * Cliente da API. Valida toda resposta pelo contrato (Zod): o que não bate
 * não é exibido.
 */
import {
  Catalogo,
  DetalheResposta,
  ListaVales,
  ResgateResposta,
  RespostaErro,
  ValeResposta,
  type Bloqueio,
  type CodigoErro,
  type Esquema,
} from "@ecoponto/contracts";
import { resumoErroDeContrato } from "@ecoponto/observability";

export type Falha =
  | { tipo: "rede" }
  | { tipo: "nao_autenticado" }
  | { tipo: "nao_encontrado" }
  | { tipo: "perfil_sem_premios" }
  | { tipo: "regra"; erro: CodigoErro; bloqueio: Bloqueio | null }
  | { tipo: "servidor"; status: number }
  | { tipo: "contrato" };

export type Resultado<T> = { ok: true; dados: T } | { ok: false; falha: Falha };

export type Reportar = (erro: unknown, contexto: Record<string, string>) => void;

const TEMPO_LIMITE_MS = 10_000;
/** O resgate espera mais: a resposta pode demorar na fila de um prêmio disputado. */
const TEMPO_LIMITE_RESGATE_MS = 20_000;

export function criarApi(fetcher: typeof fetch, reportar: Reportar) {
  async function pedir<T>(
    caminho: string,
    schema: Esquema<T>,
    rotulo: string,
    init: RequestInit = {},
    limiteMs = TEMPO_LIMITE_MS,
  ): Promise<Resultado<T>> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), limiteMs);
    let res: Response;
    try {
      res = await fetcher(caminho, {
        credentials: "same-origin",
        ...init,
        headers: { Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
        signal: ctrl.signal,
      });
    } catch {
      return { ok: false, falha: { tipo: "rede" } };
    } finally {
      clearTimeout(t);
    }

    let corpo: unknown = null;
    try {
      corpo = await res.json();
    } catch {
      corpo = null;
    }

    if (!res.ok) {
      const e = RespostaErro.safeParse(corpo);
      const codigo = e.success ? e.data.erro : null;
      if (res.status === 401) return { ok: false, falha: { tipo: "nao_autenticado" } };
      if (res.status === 404) return { ok: false, falha: { tipo: "nao_encontrado" } };
      if (codigo === "perfil_sem_premios") return { ok: false, falha: { tipo: "perfil_sem_premios" } };
      if (res.status === 409 && codigo) {
        return { ok: false, falha: { tipo: "regra", erro: codigo, bloqueio: e.success ? (e.data.bloqueio ?? null) : null } };
      }
      if (res.status >= 500) reportar(new Error(`HTTP ${res.status}`), { endpoint: rotulo });
      return { ok: false, falha: { tipo: "servidor", status: res.status } };
    }

    const r = schema.safeParse(corpo);
    if (!r.success) {
      // Só caminho e código do erro: nenhum valor vai para o Sentry.
      reportar(new Error("Resposta fora do contrato"), { endpoint: rotulo, detalhe: resumoErroDeContrato(r.error.issues) });
      return { ok: false, falha: { tipo: "contrato" } };
    }
    return { ok: true, dados: r.data };
  }

  return {
    /** Catálogo completo; os filtros da tela são aplicados no aparelho (funciona offline). */
    catalogo: () => pedir("/api/cidadao/premios", Catalogo, "premios"),
    premio: (id: string) => pedir(`/api/cidadao/premios/${encodeURIComponent(id)}`, DetalheResposta, "premio"),
    vales: () => pedir("/api/cidadao/vales?status=todos", ListaVales, "vales"),
    vale: (codigo: string) => pedir(`/api/cidadao/vales/${encodeURIComponent(codigo)}`, ValeResposta, "vale"),
    resgatar: (id: string, chave: string) =>
      pedir(
        `/api/cidadao/premios/${encodeURIComponent(id)}/resgatar`,
        ResgateResposta,
        "resgatar",
        { method: "POST", headers: { "Idempotency-Key": chave } },
        TEMPO_LIMITE_RESGATE_MS,
      ),
  };
}

export type Api = ReturnType<typeof criarApi>;
