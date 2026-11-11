/**
 * Livro-razão de pontos (T24), versão mínima.
 *
 * `lancar` grava o lançamento E atualiza o saldo no mesmo comando, dentro da
 * transação de quem chamou. Um débito maior que o saldo viola o CHECK
 * `saldo_nao_negativo` e desfaz a transação inteira: é a última defesa, além
 * da conferência feita antes pelas regras.
 *
 * A página "Meus Pontos" deve ler destas mesmas tabelas (adaptador PostgreSQL
 * da LedgerReadPort, pendente no outro repositório).
 */
import type { Executor } from "../db/db.ts";

export type TipoLancamento =
  | "entrega"
  | "bonus_campanha"
  | "resgate"
  | "estorno"
  | "doacao"
  | "credito_luz_enviado"
  | "credito_luz_devolvido"
  | "pix_entrega";

const DEBITOS = new Set<TipoLancamento>(["resgate", "doacao", "credito_luz_enviado"]);

export type NovoLancamento = {
  usuarioId: string;
  tipo: TipoLancamento;
  pontos: number;
  descricao: string;
  em: Date;
  valeId?: string | null;
  autor?: string | null;
};

/** Grava o lançamento e devolve o saldo novo. */
export async function lancar(tx: Executor, l: NovoLancamento): Promise<number> {
  if (!Number.isInteger(l.pontos) || l.pontos <= 0) throw new Error("Lançamento com pontos inválidos");
  const direcao = DEBITOS.has(l.tipo) ? "debito" : "credito";
  const delta = direcao === "debito" ? -l.pontos : l.pontos;
  // A linha do saldo precisa existir antes. (Não dá para usar INSERT … ON
  // CONFLICT DO UPDATE com o delta: o PostgreSQL confere o CHECK na linha
  // proposta, negativa num débito, antes de ver o conflito.)
  await tx.query("INSERT INTO saldos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING", [l.usuarioId]);
  const { rows } = await tx.query<{ pontos: number }>(
    `WITH l AS (
       INSERT INTO lancamentos (usuario_id, tipo, direcao, pontos, descricao, vale_id, autor, ocorrido_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     )
     UPDATE saldos SET pontos = pontos + $9, atualizado_em = $8
      WHERE usuario_id = $1
     RETURNING pontos`,
    [l.usuarioId, l.tipo, direcao, l.pontos, l.descricao, l.valeId ?? null, l.autor ?? null, l.em, delta],
  );
  const saldo = rows[0]?.pontos;
  if (typeof saldo !== "number") throw new Error("Saldo não atualizado");
  return saldo;
}

/** Saldo atual (0 se ainda não houver linha). */
export async function saldoDe(db: Executor, usuarioId: string): Promise<number> {
  const { rows } = await db.query<{ pontos: number }>("SELECT pontos FROM saldos WHERE usuario_id = $1", [usuarioId]);
  return rows[0]?.pontos ?? 0;
}
