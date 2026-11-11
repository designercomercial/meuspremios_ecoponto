/**
 * Últimos dados carregados, guardados no aparelho para abrir rápido e para
 * funcionar sem internet (catálogo, vales e cada vale aberto, com o QR).
 *
 * - Cada entrada guarda a data em que foi salva ("Dados de [dia e hora]").
 * - Separado por usuário: se o usuário muda (celular compartilhado), tudo é
 *   apagado antes de salvar o novo.
 * - Tudo é revalidado pelo contrato ao ler; entrada inválida é descartada.
 */
import type { Esquema } from "@ecoponto/contracts";

const PREFIXO = "eco-premios:v1:";
const CHAVE_USUARIO = `${PREFIXO}usuario`;
/** Limite de detalhes de prêmio guardados, para não crescer sem fim. */
const MAX_POR_TIPO: Record<string, number> = { "premio:": 15, "vale:": 40 };

export type Entrada<T> = { dados: T; salvoEm: string };

export type Cache = {
  ler<T>(chave: string, schema: Esquema<T>): Entrada<T> | null;
  salvar<T>(chave: string, dados: T, salvoEm?: string): void;
  /** Confere o dono do cache; se mudou, apaga tudo. */
  definirUsuario(ref: string): void;
  usuario(): string | null;
};

export function criarCache(storage: Storage | null, agora: () => Date): Cache {
  const seguro = <T>(fn: () => T, padrao: T): T => {
    if (!storage) return padrao;
    try {
      return fn();
    } catch {
      return padrao;
    }
  };

  const chaves = () =>
    seguro(() => {
      const out: string[] = [];
      for (let i = 0; i < storage!.length; i++) {
        const k = storage!.key(i);
        if (k?.startsWith(PREFIXO)) out.push(k);
      }
      return out;
    }, [] as string[]);

  return {
    ler(chave, schema) {
      return seguro(() => {
        const bruto = storage!.getItem(PREFIXO + chave);
        if (!bruto) return null;
        const obj = JSON.parse(bruto) as { dados?: unknown; salvoEm?: unknown };
        const r = schema.safeParse(obj.dados);
        if (!r.success || typeof obj.salvoEm !== "string") {
          storage!.removeItem(PREFIXO + chave);
          return null;
        }
        return { dados: r.data, salvoEm: obj.salvoEm };
      }, null);
    },

    salvar(chave, dados, salvoEm) {
      seguro(() => {
        for (const [tipo, max] of Object.entries(MAX_POR_TIPO)) {
          if (!chave.startsWith(tipo)) continue;
          const doTipo = chaves().filter((k) => k.startsWith(PREFIXO + tipo) && k !== PREFIXO + chave);
          if (doTipo.length >= max && doTipo[0]) storage!.removeItem(doTipo[0]);
        }
        storage!.setItem(PREFIXO + chave, JSON.stringify({ dados, salvoEm: salvoEm ?? agora().toISOString() }));
      }, undefined);
    },

    definirUsuario(ref) {
      seguro(() => {
        const atual = storage!.getItem(CHAVE_USUARIO);
        if (atual !== ref) {
          chaves().forEach((k) => storage!.removeItem(k));
          storage!.setItem(CHAVE_USUARIO, ref);
        }
      }, undefined);
    },

    usuario() {
      return seguro(() => storage!.getItem(CHAVE_USUARIO), null);
    },
  };
}
