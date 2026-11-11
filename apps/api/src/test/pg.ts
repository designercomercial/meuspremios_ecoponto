/** Um banco novo e vazio por arquivo de teste, no servidor do setup global. */
import { inject } from "vitest";
import { criarDbPg, type Db } from "../db/db.ts";

export async function bancoNovo(maxConexoes = 25): Promise<Db> {
  const base = inject("pgUrl");
  const nome = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = await criarDbPg(base, 1);
  await admin.query(`CREATE DATABASE ${nome}`);
  await admin.fechar();
  const url = new URL(base);
  url.pathname = `/${nome}`;
  return criarDbPg(url.toString(), maxConexoes);
}
