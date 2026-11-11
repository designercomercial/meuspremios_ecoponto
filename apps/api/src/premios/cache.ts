/**
 * Cache do catálogo (T28: prêmio ativado aparece no app em até 1 minuto).
 *
 * Guarda só a lista de prêmios ativos, que é igual para todos. Saldo, nível,
 * limite do mês e o motivo de bloqueio são calculados a cada pedido, nunca
 * vêm do cache. Depois de um resgate, o cache é apagado (o estoque mudou).
 *
 * Redis quando houver REDIS_URL (vários servidores compartilham); senão, em
 * memória no processo. Nos dois casos o prazo é de no máximo 60 s.
 */

export const TTL_CATALOGO_MS = 60_000;

export interface CacheCatalogo {
  obter<T>(chave: string, carregar: () => Promise<T>): Promise<T>;
  apagar(chave: string): Promise<void>;
}

export function cacheEmMemoria(agora: () => Date, ttlMs = TTL_CATALOGO_MS): CacheCatalogo {
  const m = new Map<string, { expira: number; valor: unknown }>();
  return {
    async obter<T>(chave: string, carregar: () => Promise<T>): Promise<T> {
      const e = m.get(chave);
      if (e && e.expira > agora().getTime()) return e.valor as T;
      const valor = await carregar();
      m.set(chave, { expira: agora().getTime() + ttlMs, valor });
      return valor;
    },
    async apagar(chave) {
      m.delete(chave);
    },
  };
}

/** Redis. Se o Redis falhar, lê direto do banco (o cache nunca derruba a página). */
export async function cacheRedis(url: string, ttlMs = TTL_CATALOGO_MS): Promise<CacheCatalogo> {
  const { Redis } = await import("ioredis");
  const r = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  r.on("error", () => {});
  const prefixo = "eco-premios:";
  return {
    async obter<T>(chave: string, carregar: () => Promise<T>): Promise<T> {
      try {
        const bruto = await r.get(prefixo + chave);
        if (bruto) return JSON.parse(bruto) as T;
      } catch {
        return carregar();
      }
      const valor = await carregar();
      await r.set(prefixo + chave, JSON.stringify(valor), "PX", ttlMs).catch(() => {});
      return valor;
    },
    async apagar(chave) {
      await r.del(prefixo + chave).catch(() => {});
    },
  };
}
