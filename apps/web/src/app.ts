/**
 * Prêmios – controlador da página.
 *
 * Fluxo de cada tela:
 *  1. Mostra na hora o que está guardado no aparelho (ou o skeleton).
 *  2. Busca na API; se chegou, guarda e redesenha.
 *  3. Se a rede falhou e havia dados guardados, mantém e mostra
 *     "Sem internet. Dados de [dia e hora]". Se não havia, mostra o erro.
 *
 * Sem internet o botão de troca fica desabilitado, mas os vales disponíveis
 * continuam abrindo com o QR (gerado no aparelho).
 *
 * O perfil (cidadão/catador), o saldo e o motivo de bloqueio vêm só do servidor.
 */
import {
  Catalogo,
  DetalheResposta,
  ListaVales,
  Vale,
  type CatalogoCidadao,
  type CodigoErro,
  type Esquema,
  type FiltroVales,
  type ValesCidadao,
} from "@ecoponto/contracts";
import { criarApi, type Falha, type Reportar, type Resultado } from "./api.ts";
import { criarCache } from "./cache.ts";
import type { Links } from "./config.ts";
import { h, substituir } from "./dom.ts";
import { lerRota, urlDaRota, type FiltrosCatalogo, type Rota } from "./router.ts";
import { viewCatalogo } from "./views/catalogo.ts";
import { abas, faixaSaldo } from "./views/comuns.ts";
import { dialogoConfirmacao, viewDetalhe, type Mensagem } from "./views/detalhe.ts";
import { avisoCatador, avisoOffline, erro, naoEncontrado, skeleton } from "./views/estados.ts";
import { viewVale } from "./views/vale.ts";
import { viewVales } from "./views/vales.ts";

export type Deps = {
  raiz: HTMLElement;
  fetch: typeof fetch;
  storage: Storage | null;
  online: () => boolean;
  agora: () => Date;
  links: Links;
  reportar: Reportar;
  /** Idempotency-Key de cada troca. Padrão: crypto.randomUUID(). */
  gerarChave?: () => string;
};

const SaldoGuardado = { safeParse: (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? { success: true as const, data: x } : { success: false as const, error: { issues: [] } }) } satisfies Esquema<number>;

/** Mensagem de cada erro de troca, como pede a especificação. */
export function mensagemDeErro(erroTroca: CodigoErro | "rede" | "outro", textoBloqueio: string | null = null): string {
  switch (erroTroca) {
    case "esgotado":
      return "Este prêmio acabou de esgotar.";
    case "saldo_insuficiente":
      return "Seu saldo mudou e não é mais suficiente.";
    case "limite_mensal":
      return "Você atingiu o limite deste prêmio no mês.";
    case "oferta_encerrada":
      return "A oferta deste prêmio foi encerrada.";
    case "nivel_insuficiente":
      return textoBloqueio ? `${textoBloqueio}.` : "Este prêmio é de um nível acima do seu.";
    default:
      return "Não foi possível concluir a troca. Seus pontos não foram descontados. Tente de novo.";
  }
}

export function criarApp(d: Deps) {
  const api = criarApi(d.fetch, d.reportar);
  const cache = criarCache(d.storage, d.agora);
  const gerarChave = d.gerarChave ?? (() => crypto.randomUUID());

  let geracao = 0;
  let semRede = false;
  let saldo: number | null = cache.ler("saldo", SaldoGuardado)?.dados ?? null;
  let perfilCatador = false;
  let catalogoAtual: CatalogoCidadao | null = null;
  let valesAtuais: ValesCidadao | null = null;
  let mensagemDetalhe: Mensagem = null;
  let fecharDialogo: (() => void) | null = null;
  /** Chave da última troca que caiu por rede: reusada no próximo toque (sem débito duplo). */
  const chavesPendentes = new Map<string, string>();
  const pendentes = new Set<Promise<unknown>>();

  // ---- Esqueleto da página ----
  const slotSaldo = h("div");
  const slotAbas = h("div");
  const slotFaixa = h("div", { class: "faixa-slot" });
  const main = h("main", { id: "conteudo", class: "page", tabindex: "-1" });
  d.raiz.replaceChildren(slotSaldo, slotAbas, slotFaixa, main);

  const offline = () => !d.online() || semRede;

  function rotaAtual(): Rota {
    return lerRota(location.pathname, location.search);
  }

  function moldura(rota: Rota): void {
    if (perfilCatador) {
      substituir(slotSaldo);
      substituir(slotAbas);
      return;
    }
    substituir(slotSaldo, faixaSaldo(saldo));
    substituir(slotAbas, abas(rota.nome === "vales" || rota.nome === "vale" ? "vales" : "catalogo"));
  }

  function conteudo(el: HTMLElement, salvoEm: string | null = null): void {
    substituir(slotFaixa, salvoEm ? avisoOffline(salvoEm, () => renderizar()) : null);
    substituir(main, el);
  }

  function atualizarSaldo(novo: number): void {
    saldo = novo;
    cache.salvar("saldo", novo);
    const el = slotSaldo.firstElementChild;
    if (el && !perfilCatador) substituir(slotSaldo, faixaSaldo(saldo));
  }

  /** Busca com cache: desenha o guardado já, depois o da rede. */
  function carregar<T, G>(o: {
    chave: string;
    schemaCache: Esquema<G>;
    forma: Parameters<typeof skeleton>[0];
    buscar: () => Promise<Resultado<T>>;
    /** Dado da rede → { ref do usuário, o que guardar, o que desenhar }. */
    receber: (dados: T) => { ref: string; guardar: G };
    desenhar: (dados: G, salvoEm: string | null) => void;
    aoFalhar?: (f: Falha) => boolean;
  }): Promise<void> {
    const g = geracao;
    const guardado = cache.ler(o.chave, o.schemaCache);
    if (guardado) o.desenhar(guardado.dados, offline() ? guardado.salvoEm : null);
    else conteudo(skeleton(o.forma));

    const p = o.buscar().then((r) => {
      if (g !== geracao) return;
      if (r.ok) {
        semRede = false;
        const { ref, guardar } = o.receber(r.dados);
        cache.definirUsuario(ref);
        cache.salvar(o.chave, guardar);
        o.desenhar(guardar, null);
        return;
      }
      if (r.falha.tipo === "rede") semRede = true;
      if (r.falha.tipo === "rede" && guardado) {
        o.desenhar(guardado.dados, guardado.salvoEm);
        return;
      }
      if (o.aoFalhar?.(r.falha)) return;
      conteudo(erro(r.falha, d.online(), () => renderizar()));
    });
    pendentes.add(p);
    void p.finally(() => pendentes.delete(p));
    return p;
  }

  // ---------------------------------------------------------------------------
  // Telas
  // ---------------------------------------------------------------------------

  function telaCatalogo(filtros: FiltrosCatalogo): Promise<void> {
    document.title = "Prêmios – EcoPonto";
    return carregar({
      chave: "catalogo",
      schemaCache: Catalogo,
      forma: "catalogo",
      buscar: () => api.catalogo(),
      receber: (c) => ({ ref: c.usuarioRef, guardar: c }),
      desenhar: (c, salvoEm) => {
        if (c.perfil === "catador") {
          perfilCatador = true;
          moldura(rotaAtual());
          conteudo(avisoCatador());
          return;
        }
        perfilCatador = false;
        catalogoAtual = c;
        atualizarSaldo(c.saldo);
        moldura(rotaAtual());
        conteudo(viewCatalogo(c, filtros, filtrar), salvoEm);
      },
    });
  }

  /** Filtros mudam a URL (dá para voltar) sem buscar de novo. */
  function filtrar(f: FiltrosCatalogo): void {
    const foco = document.activeElement as HTMLElement | null;
    const seletor = foco?.dataset.categoria
      ? `[data-categoria="${foco.dataset.categoria}"]`
      : foco?.dataset.atalho
        ? `[data-atalho="${foco.dataset.atalho}"]`
        : foco?.id === "ordem"
          ? "#ordem"
          : null;
    history.replaceState(null, "", urlDaRota({ nome: "catalogo", filtros: f }));
    if (catalogoAtual) substituir(main, viewCatalogo(catalogoAtual, f, filtrar));
    if (seletor) main.querySelector<HTMLElement>(seletor)?.focus();
  }

  function telaPremio(id: string): Promise<void> {
    return carregar({
      chave: `premio:${id}`,
      schemaCache: DetalheResposta,
      forma: "detalhe",
      buscar: () => api.premio(id),
      receber: (r) => ({ ref: r.usuarioRef, guardar: r }),
      desenhar: (r, salvoEm) => {
        document.title = `${r.premio.nome} – Prêmios`;
        atualizarSaldo(r.saldo);
        moldura(rotaAtual());
        conteudo(viewDetalhe(r, { offline: offline(), mensagem: mensagemDetalhe, aoTrocar: () => abrirConfirmacao(r) }), salvoEm);
      },
      aoFalhar: (f) => {
        if (f.tipo === "nao_encontrado") conteudo(naoEncontrado("premio"));
        else if (f.tipo === "perfil_sem_premios") {
          perfilCatador = true;
          moldura(rotaAtual());
          conteudo(avisoCatador());
        } else return false;
        return true;
      },
    });
  }

  function telaVales(filtro: FiltroVales): Promise<void> {
    document.title = "Meus vales – Prêmios";
    return carregar({
      chave: "vales",
      schemaCache: ListaVales,
      forma: "vales",
      buscar: () => api.vales(),
      receber: (v) => ({ ref: v.usuarioRef, guardar: v }),
      desenhar: (v, salvoEm) => {
        if (v.perfil === "catador") {
          perfilCatador = true;
          moldura(rotaAtual());
          conteudo(avisoCatador());
          return;
        }
        perfilCatador = false;
        valesAtuais = v;
        atualizarSaldo(v.saldo);
        // Cada vale fica guardado: abre sem internet, com o QR, na portaria.
        if (!salvoEm) for (const vale of v.vales) cache.salvar(`vale:${vale.codigo}`, vale);
        moldura(rotaAtual());
        conteudo(viewVales(v, filtro, filtrarVales), salvoEm);
      },
    });
  }

  function filtrarVales(f: FiltroVales): void {
    history.replaceState(null, "", urlDaRota({ nome: "vales", filtro: f }));
    if (valesAtuais) substituir(main, viewVales(valesAtuais, f, filtrarVales));
    main.querySelector<HTMLElement>(`[data-filtro="${f}"]`)?.focus();
  }

  function telaVale(codigo: string, novo: boolean): Promise<void> {
    document.title = "Vale – Prêmios";
    return carregar({
      chave: `vale:${codigo}`,
      schemaCache: Vale,
      forma: "vale",
      buscar: () => api.vale(codigo),
      receber: (r) => ({ ref: r.usuarioRef, guardar: r.vale }),
      desenhar: (v, salvoEm) => {
        moldura(rotaAtual());
        conteudo(viewVale(v, { novo, links: d.links }), salvoEm);
      },
      aoFalhar: (f) => {
        if (f.tipo !== "nao_encontrado") return false;
        conteudo(naoEncontrado("vale"));
        return true;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Troca
  // ---------------------------------------------------------------------------

  function abrirConfirmacao(r: { premio: DetalheResposta["premio"]; saldo: number }): void {
    if (offline() || r.premio.bloqueio) return;
    const id = r.premio.id;
    // A mesma chave vale para todos os toques deste diálogo e para a nova
    // tentativa depois de uma falha de rede: o servidor nunca gera dois vales.
    const chave = chavesPendentes.get(id) ?? gerarChave();
    chavesPendentes.set(id, chave);
    let enviando = false;

    const fechar = () => {
      dlg.el.remove();
      d.raiz.removeAttribute("inert");
      d.raiz.removeAttribute("aria-hidden");
      fecharDialogo = null;
      document.getElementById("trocar")?.focus();
    };

    const dlg = dialogoConfirmacao(r.premio, r.saldo, {
      voltar: fechar,
      confirmar: () => {
        if (enviando) return;
        enviando = true;
        dlg.ocupado(true);
        const p = api.resgatar(id, chave).then((res) => {
          enviando = false;
          if (res.ok) {
            chavesPendentes.delete(id);
            mensagemDetalhe = null;
            atualizarSaldo(res.dados.saldo);
            cache.salvar(`vale:${res.dados.vale.codigo}`, res.dados.vale);
            fechar();
            navegar({ nome: "vale", codigo: res.dados.vale.codigo, novo: true });
            return;
          }
          const f = res.falha;
          // Erro de regra é definitivo: a próxima tentativa é um pedido novo.
          if (f.tipo === "regra") chavesPendentes.delete(id);
          if (f.tipo === "rede") semRede = !d.online();
          mensagemDetalhe = {
            tom: "erro",
            texto:
              f.tipo === "regra"
                ? mensagemDeErro(f.erro, f.bloqueio?.texto ?? null)
                : f.tipo === "nao_autenticado"
                  ? "Sua sessão terminou. Feche esta tela e abra Prêmios de novo pelo app."
                  : mensagemDeErro("outro"),
          };
          fechar();
          // Lista atualizada: busca o detalhe de novo (estoque e bloqueio atuais).
          void renderizar(false);
        });
        pendentes.add(p);
        void p.finally(() => pendentes.delete(p));
      },
    });

    d.raiz.setAttribute("inert", "");
    d.raiz.setAttribute("aria-hidden", "true");
    document.body.append(dlg.el);
    fecharDialogo = fechar;
    dlg.el.querySelector<HTMLButtonElement>('[data-acao="confirmar"]')?.focus();
  }

  // ---------------------------------------------------------------------------
  // Navegação
  // ---------------------------------------------------------------------------

  function renderizar(focar = false): Promise<void> {
    geracao++;
    fecharDialogo?.();
    const rota = rotaAtual();
    if (rota.nome !== "premio") mensagemDetalhe = null;
    moldura(rota);
    let p: Promise<void>;
    switch (rota.nome) {
      case "catalogo":
        p = telaCatalogo(rota.filtros);
        break;
      case "premio":
        p = telaPremio(rota.id);
        break;
      case "vales":
        p = telaVales(rota.filtro);
        break;
      case "vale":
        p = telaVale(rota.codigo, rota.novo);
        break;
      default:
        conteudo(naoEncontrado("pagina"));
        p = Promise.resolve();
    }
    if (focar) {
      main.focus({ preventScroll: true });
      window.scrollTo?.(0, 0);
    }
    return p;
  }

  function navegar(rota: Rota): void {
    history.pushState(null, "", urlDaRota(rota));
    void renderizar(true);
  }

  d.raiz.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[data-interno]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const url = new URL((a as HTMLAnchorElement).href, location.href);
    history.pushState(null, "", url.pathname + url.search);
    void renderizar(true);
  });

  return {
    iniciar(): Promise<void> {
      window.addEventListener("popstate", () => void renderizar(true));
      return renderizar(false);
    },
    /** Rede voltou ou caiu: redesenha (o botão de troca liga ou desliga). */
    mudouConexao(): Promise<void> {
      if (d.online()) semRede = false;
      return renderizar(false);
    },
    renderizar,
    /** Espera todas as buscas em andamento (testes). */
    async ocioso(): Promise<void> {
      while (pendentes.size) await Promise.all([...pendentes]);
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

export type App = ReturnType<typeof criarApp>;
