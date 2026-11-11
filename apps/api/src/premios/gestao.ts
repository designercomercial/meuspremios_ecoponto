/**
 * Baixa e cancelamento do vale (T27) – FORA DO ESCOPO desta página.
 *
 * Existem aqui só para os dados de exemplo e para os testes (critério 6:
 * vale cancelado mostra o status e o estorno entra no livro-razão). Não há
 * rota HTTP para elas. O painel da gestão e a portaria vão usar a mesma regra:
 *   - baixa: atendente ou gestão, só em vale disponível e dentro do prazo;
 *   - cancelamento: só gestão; devolve os pontos com um lançamento de estorno
 *     que registra quem cancelou, e devolve a unidade ao estoque.
 */
import type { Db } from "../db/db.ts";
import { lancar } from "../ledger/ledger.ts";

type ValeTravado = { id: string; usuario_id: string; premio_id: string; custo: number; status: string; retirar_ate: Date };

async function travar(tx: Parameters<Parameters<Db["transacao"]>[0]>[0], codigo: string): Promise<ValeTravado> {
  const { rows } = await tx.query<ValeTravado>(
    "SELECT id, usuario_id, premio_id, custo, status, retirar_ate FROM vales WHERE codigo = $1 FOR UPDATE",
    [codigo],
  );
  const v = rows[0];
  if (!v) throw new Error("Vale não encontrado");
  if (v.status !== "disponivel") throw new Error(`Vale não está disponível (${v.status})`);
  return v;
}

export async function cancelarVale(db: Db, a: { codigo: string; gestor: string; em: Date }): Promise<void> {
  await db.transacao(async (tx) => {
    const v = await travar(tx, a.codigo);
    await tx.query("UPDATE vales SET status = 'cancelado', cancelado_em = $2, cancelado_por = $3 WHERE id = $1", [v.id, a.em, a.gestor]);
    await tx.query("UPDATE premios SET estoque = estoque + 1 WHERE id = $1", [v.premio_id]);
    await lancar(tx, {
      usuarioId: v.usuario_id,
      tipo: "estorno",
      pontos: v.custo,
      descricao: "Vale cancelado: pontos devolvidos",
      em: a.em,
      valeId: v.id,
      autor: a.gestor,
    });
  });
}

export async function retirarVale(db: Db, a: { codigo: string; ecoponto: string; atendente: string; em: Date }): Promise<void> {
  await db.transacao(async (tx) => {
    const v = await travar(tx, a.codigo);
    if (a.em.getTime() > new Date(v.retirar_ate).getTime()) throw new Error("Prazo de retirada encerrado");
    await tx.query(
      "UPDATE vales SET status = 'retirado', retirado_em = $2, retirado_ecoponto = $3, retirado_por = $4 WHERE id = $1",
      [v.id, a.em, a.ecoponto, a.atendente],
    );
  });
}
