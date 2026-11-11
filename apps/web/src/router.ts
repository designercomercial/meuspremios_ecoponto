import { Categoria, CodigoVale, FiltroVales, IdPremio } from "@ecoponto/contracts";

export const BASE = "/premios";

export type Ordem = "menor" | "maior";
export type FiltrosCatalogo = { categoria: Categoria | null; possoTrocar: boolean; ordem: Ordem };

export type Rota =
  | { nome: "catalogo"; filtros: FiltrosCatalogo }
  | { nome: "premio"; id: string }
  | { nome: "vales"; filtro: FiltroVales }
  | { nome: "vale"; codigo: string; novo: boolean }
  | { nome: "nao_encontrado" };

/**
 * /premios/?categoria=casa&disponiveis=1&ordem=maior → catálogo
 * /premios/premio/{id}                              → detalhe do prêmio
 * /premios/vales?filtro=todos                       → meus vales
 * /premios/vale/{codigo}                            → vale (endereço próprio)
 */
export function lerRota(pathname: string, search: string): Rota {
  const caminho = pathname.replace(/\/+$/, "");
  const q = new URLSearchParams(search);
  if (caminho === BASE || caminho === "" || !caminho.startsWith(BASE)) {
    const c = Categoria.safeParse(q.get("categoria"));
    return {
      nome: "catalogo",
      filtros: {
        categoria: c.success ? c.data : null,
        possoTrocar: q.get("disponiveis") === "1",
        ordem: q.get("ordem") === "maior" ? "maior" : "menor",
      },
    };
  }
  const resto = caminho.slice(BASE.length);
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  const premio = /^\/premio\/([^/]+)$/.exec(resto);
  if (premio?.[1]) {
    const id = IdPremio.safeParse(dec(premio[1]));
    return id.success ? { nome: "premio", id: id.data } : { nome: "nao_encontrado" };
  }
  const vale = /^\/vale\/([^/]+)$/.exec(resto);
  if (vale?.[1]) {
    const codigo = CodigoVale.safeParse(dec(vale[1]).toUpperCase());
    return codigo.success ? { nome: "vale", codigo: codigo.data, novo: q.get("novo") === "1" } : { nome: "nao_encontrado" };
  }
  if (resto === "/vales") return { nome: "vales", filtro: q.get("filtro") === "todos" ? "todos" : "disponiveis" };
  return { nome: "nao_encontrado" };
}

export function urlDaRota(r: Rota): string {
  switch (r.nome) {
    case "catalogo": {
      const q = new URLSearchParams();
      if (r.filtros.categoria) q.set("categoria", r.filtros.categoria);
      if (r.filtros.possoTrocar) q.set("disponiveis", "1");
      if (r.filtros.ordem === "maior") q.set("ordem", "maior");
      const s = q.toString();
      return `${BASE}/${s ? `?${s}` : ""}`;
    }
    case "premio":
      return `${BASE}/premio/${encodeURIComponent(r.id)}`;
    case "vales":
      return r.filtro === "todos" ? `${BASE}/vales?filtro=todos` : `${BASE}/vales`;
    case "vale":
      return `${BASE}/vale/${encodeURIComponent(r.codigo)}${r.novo ? "?novo=1" : ""}`;
    case "nao_encontrado":
      return `${BASE}/`;
  }
}

export const CATALOGO_PADRAO: Rota = { nome: "catalogo", filtros: { categoria: null, possoTrocar: false, ordem: "menor" } };
