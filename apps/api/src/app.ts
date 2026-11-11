/**
 * API da página "Prêmios".
 *
 *   GET  /api/cidadao/premios?categoria=&disponiveis=
 *   GET  /api/cidadao/premios/{id}
 *   POST /api/cidadao/premios/{id}/resgatar        (header Idempotency-Key)
 *   GET  /api/cidadao/vales?status=disponiveis|todos
 *   GET  /api/cidadao/vales/{codigo}
 *
 * Toda rota usa o usuário da SESSÃO. Nenhum parâmetro do cliente escolhe de
 * quem são os dados nem qual é o perfil. Toda resposta é validada pelo
 * contrato antes de sair.
 */
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  Catalogo,
  CatalogoQuery,
  CodigoVale,
  DetalheResposta,
  IdempotencyKey,
  IdPremio,
  ListaVales,
  ResgateResposta,
  ValeResposta,
  ValesQuery,
  type Bloqueio,
  type CodigoErro,
  type Esquema,
} from "@ecoponto/contracts";
import { limparUrl, resumoErroDeContrato } from "@ecoponto/observability";
import { COOKIE_SESSAO, type AuthPort, type Sessao } from "./auth.ts";
import type { ServicoPremios } from "./premios/servico.ts";

export type Reportar = (erro: unknown, contexto: Record<string, string>) => void;

export type OpcoesApp = {
  auth: AuthPort;
  servico: ServicoPremios;
  /** Rotas /dev para entrar como uma pessoa dos mocks. Nunca em produção. */
  devLogin?: { tokens: Readonly<Record<string, string>> } | undefined;
  reportar?: Reportar | undefined;
  /** true, ou um destino de log (testes leem o log estruturado do resgate). */
  logger?: boolean | { stream: { write(linha: string): void } } | undefined;
};

declare module "fastify" {
  interface FastifyRequest {
    sessao: Sessao | null;
  }
}

/** Erros de regra do resgate → 409, com o bloqueio atual para a tela. */
const STATUS_ERRO: Partial<Record<CodigoErro, number>> = {
  nao_autenticado: 401,
  parametro_invalido: 400,
  idempotency_key_ausente: 400,
  perfil_sem_premios: 403,
  premio_nao_encontrado: 404,
  vale_nao_encontrado: 404,
  idempotency_key_reutilizada: 422,
  esgotado: 409,
  oferta_encerrada: 409,
  nivel_insuficiente: 409,
  limite_mensal: 409,
  saldo_insuficiente: 409,
};

function erro(reply: FastifyReply, codigo: CodigoErro, bloqueio?: Bloqueio | null) {
  return reply.code(STATUS_ERRO[codigo] ?? 500).send(bloqueio === undefined ? { erro: codigo } : { erro: codigo, bloqueio });
}

export async function buildApp(opts: OpcoesApp): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          ...(typeof opts.logger === "object" ? { stream: opts.logger.stream } : {}),
          // Nada de cookie, token, query string ou código de vale no log.
          serializers: {
            req: (req: FastifyRequest) => ({ method: req.method, url: limparUrl(req.url) }),
          },
        }
      : false,
  });
  const reportar: Reportar = opts.reportar ?? (() => {});
  const { servico } = opts;

  await app.register(cookie);
  app.decorateRequest("sessao", null);

  app.setErrorHandler((e, req, reply) => {
    const rota = req.routeOptions.url ?? "desconhecida";
    reportar(e, { rota });
    req.log.error({ rota, codigo: (e as { code?: string }).code }, "erro na rota");
    return erro(reply, "interno");
  });

  await app.register(
    async (r) => {
      r.addHook("onRequest", async (req, reply) => {
        req.sessao = await opts.auth.autenticar(req);
        if (!req.sessao) return erro(reply, "nao_autenticado");
        // Dados de uma pessoa: nem navegador nem proxy guardam (a página
        // guarda o que precisa para o offline, separado por usuário).
        reply.header("Cache-Control", "private, no-store");
        reply.header("Vary", "Cookie, Authorization");
      });

      /** Valida a saída contra o contrato antes de enviar. */
      function enviar<T>(reply: FastifyReply, schema: Esquema<T>, dados: unknown, rota: string, status = 200) {
        const v = schema.safeParse(dados);
        if (!v.success) {
          reportar(new Error("Resposta fora do contrato"), { rota, detalhe: resumoErroDeContrato(v.error.issues) });
          return erro(reply, "interno");
        }
        return reply.code(status).send(v.data);
      }

      // ---- Catálogo ----
      r.get("/premios", async (req, reply) => {
        const q = CatalogoQuery.safeParse(req.query);
        if (!q.success) return erro(reply, "parametro_invalido");
        const disponiveis = q.data.disponiveis === "true" || q.data.disponiveis === "1";
        const c = await servico.catalogo(req.sessao!.usuarioId, { categoria: q.data.categoria, disponiveis });
        if (!c) return erro(reply, "nao_autenticado");
        return enviar(reply, Catalogo, c, "premios");
      });

      // ---- Detalhe ----
      r.get<{ Params: { id: string } }>("/premios/:id", async (req, reply) => {
        const id = IdPremio.safeParse(req.params.id);
        if (!id.success) return erro(reply, "premio_nao_encontrado");
        const d = await servico.detalhe(req.sessao!.usuarioId, id.data);
        if (d === "catador") return erro(reply, "perfil_sem_premios");
        if (!d) return erro(reply, "premio_nao_encontrado");
        return enviar(reply, DetalheResposta, d, "premio");
      });

      // ---- Resgate ----
      r.post<{ Params: { id: string } }>("/premios/:id/resgatar", async (req, reply) => {
        const inicio = performance.now();
        const id = IdPremio.safeParse(req.params.id);
        const bruta = req.headers["idempotency-key"];
        const log = (resultado: "sucesso" | "repetido" | "erro", motivo: string | null) =>
          req.log.info(
            {
              evento: "resgate",
              resultado,
              motivo,
              premio: id.success ? id.data : null,
              duracaoMs: Math.round((performance.now() - inicio) * 10) / 10,
            },
            "resgate",
          );

        if (!id.success) {
          log("erro", "premio_nao_encontrado");
          return erro(reply, "premio_nao_encontrado");
        }
        if (typeof bruta !== "string" || bruta === "") {
          log("erro", "idempotency_key_ausente");
          return erro(reply, "idempotency_key_ausente");
        }
        const chave = IdempotencyKey.safeParse(bruta);
        if (!chave.success) {
          log("erro", "parametro_invalido");
          return erro(reply, "parametro_invalido");
        }

        let res: Awaited<ReturnType<ServicoPremios["resgatar"]>>;
        try {
          res = await servico.resgatar(req.sessao!.usuarioId, id.data, chave.data);
        } catch (e) {
          log("erro", "interno");
          throw e;
        }
        if (!res.ok) {
          log("erro", res.erro);
          return erro(reply, res.erro, STATUS_ERRO[res.erro] === 409 ? res.bloqueio : undefined);
        }
        log(res.repetido ? "repetido" : "sucesso", null);
        return enviar(reply, ResgateResposta, { vale: res.vale, saldo: res.saldo, repetido: res.repetido }, "resgatar", res.repetido ? 200 : 201);
      });

      // ---- Vales ----
      r.get("/vales", async (req, reply) => {
        const q = ValesQuery.safeParse(req.query);
        if (!q.success) return erro(reply, "parametro_invalido");
        const v = await servico.vales(req.sessao!.usuarioId, q.data.status ?? "disponiveis");
        if (!v) return erro(reply, "nao_autenticado");
        return enviar(reply, ListaVales, v, "vales");
      });

      r.get<{ Params: { codigo: string } }>("/vales/:codigo", async (req, reply) => {
        const codigo = CodigoVale.safeParse(req.params.codigo.toUpperCase());
        // Código malformado, inexistente ou de outra pessoa: mesma resposta.
        if (!codigo.success) return erro(reply, "vale_nao_encontrado");
        const v = await servico.vale(req.sessao!.usuarioId, codigo.data);
        if (!v) return erro(reply, "vale_nao_encontrado");
        return enviar(reply, ValeResposta, v, "vale");
      });
    },
    { prefix: "/api/cidadao" },
  );

  // ---- Entrada de desenvolvimento (só com mocks) ----
  if (opts.devLogin) {
    const tokens = opts.devLogin.tokens;
    app.get("/dev", async (_req, reply) => {
      const links = Object.keys(tokens)
        .map((t) => `<li><a href="/dev/entrar?como=${encodeURIComponent(t)}">${t.replace(/^dev-/, "")}</a></li>`)
        .join("");
      return reply
        .type("text/html; charset=utf-8")
        .send(
          `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar (desenvolvimento)</title><body style="font:16px system-ui;padding:16px"><h1>Entrar como (só desenvolvimento)</h1><ul style="line-height:2.5">${links}</ul><p><a href="/dev/sair">Sair</a></p></body></html>`,
        );
    });
    app.get<{ Querystring: { como?: string; para?: string } }>("/dev/entrar", async (req, reply) => {
      const t = req.query.como ?? "";
      if (!Object.hasOwn(tokens, t)) return reply.code(400).send("Pessoa desconhecida");
      const para = req.query.para?.startsWith("/premios") ? req.query.para : "/premios/";
      return reply.setCookie(COOKIE_SESSAO, t, { path: "/", httpOnly: true, sameSite: "lax" }).redirect(para);
    });
    app.get("/dev/sair", async (_req, reply) => reply.clearCookie(COOKIE_SESSAO, { path: "/" }).redirect("/dev"));
  }

  return app;
}
