# Prêmios – ECOponto Boa Vista

Página do canal "Prêmios" do app do cidadão (plataforma SASI), aberta em webview, e o resgate no servidor.
O cidadão vê o catálogo, troca pontos por um prêmio e recebe um **vale** (código + QR) para retirar na portaria de um ecoponto.

## Como rodar

Requisitos: Node 22+ e pnpm 12 (`corepack enable pnpm`). Não precisa instalar PostgreSQL nem Docker.

```bash
pnpm install
pnpm dev          # API em :3000 + Vite em :5174 → http://localhost:5174/premios/
```

O `pnpm dev` usa o **PGlite** (PostgreSQL em WASM, em memória) com os dados de exemplo e entra sempre como `cidadao-luz`.
Para escolher a pessoa (`cidadao-luz`, `cidadao-novo`, `catador`) em `/dev`, use `pnpm --filter @ecoponto/api dev:escolher`.

Com um PostgreSQL de verdade:

```bash
DATABASE_URL=postgres://... pnpm --filter @ecoponto/api exec tsx src/server.ts --pessoa=cidadao-luz --seed
```

| Pessoa | O que mostra |
|---|---|
| `cidadao-luz` | saldo 1.250, nível 2, 5 vales (disponível, disponível vencendo em 5 dias, retirado, cancelado com estorno, vencido) |
| `cidadao-novo` | saldo 300, sem vales |
| `catador` | mensagem do Pix, sem catálogo |

Os 12 prêmios incluem estoque baixo (2 e 3 unidades), 1 esgotado, 1 com oferta encerrada, 1 com nível mínimo, 1 com limite mensal atingido e 1 que custa mais do que o saldo ("Faltam 150 pontos").

Testes:

```bash
pnpm test        # unitários, API (PGlite + PostgreSQL real) e telas (Vitest)
pnpm typecheck
pnpm test:e2e    # Playwright: troca completa, offline com service worker, 360 px, QR no tema escuro
```

Os testes de concorrência sobem um **PostgreSQL real** pelo pacote `embedded-postgres`. Para usar outro servidor: `ECO_PG_TESTE=postgres://...`.

## Como a transação garante o estoque e o saldo

`apps/api/src/premios/servico.ts`, função `resgatar`. É uma única transação (READ COMMITTED), que trava as linhas sempre na mesma ordem, para não haver deadlock:

1. **Idempotência.** `INSERT INTO resgate_idempotencia (usuario_id, chave)`, com chave primária nos dois campos. Um segundo pedido com a mesma `Idempotency-Key` espera no índice até o primeiro terminar:
   - se o primeiro gravou, o segundo devolve o mesmo vale, com `repetido: true` e sem novo débito;
   - se o primeiro falhou, o segundo segue normalmente.
2. **Saldo.** `SELECT … FROM saldos … FOR UPDATE`: os pedidos do mesmo cidadão entram em fila.
3. **Prêmio.** `SELECT … FROM premios … FOR UPDATE`: os pedidos pelo mesmo prêmio entram em fila. Quem chega depois pelo último item já vê o estoque 0 e recebe "Esgotado".
4. **Regras.** Confere todas de novo com `avaliarBloqueio` (`packages/regras`), a mesma função que calcula o motivo de bloqueio do catálogo.
5. **Gravação.** Baixa o estoque, cria o vale e lança o débito no livro-razão (`lancar`, que atualiza o saldo no mesmo comando).

Se qualquer passo falhar, o ROLLBACK desfaz tudo. Os `CHECK (estoque >= 0)` e `CHECK (saldo >= 0)` do banco são a última defesa.

Comprovado em `apps/api/src/resgate.pg.test.ts`, com pedidos realmente simultâneos num PostgreSQL real:
- dois cidadãos pelo último item (20 rodadas): um sucesso e um "Esgotado";
- 12 resgates simultâneos do mesmo cidadão: o saldo nunca fica negativo e bate com a soma do livro-razão;
- 6 pedidos com a mesma chave: um único vale e um único débito;
- uma falha depois da baixa do estoque: nada é gravado.

**Livro-razão (T24).** Ainda não existia. Foi criado aqui na versão mínima: `lancamentos`, só com inserções, e `saldos`, atualizado na mesma transação. Os tipos de lançamento são os mesmos de "Meus Pontos". O cancelamento pela gestão grava um `estorno` com o autor. Ver `apps/api/src/db/schema.ts`.

**Cache do catálogo.** A lista de prêmios ativos fica no Redis (`REDIS_URL`) ou em memória por **60 s**, então um prêmio ativado aparece em até 1 minuto. Saldo, nível, limite do mês e bloqueio são calculados a cada pedido. O resgate apaga o cache, e o detalhe sempre lê o banco.

## Onde ficam os tokens

`packages/tokens/tokens.css`, o único arquivo com cores. Tem os mesmos valores de "Minha Carteirinha" e "Meus Pontos", mais:
- os selos de vale: `--status-disponivel` (verde), `--status-retirado` (azul claro) e `--status-encerrado` (cinza neutro, para cancelado e vencido), todos com texto branco e contraste AA;
- `--qr-fg` e `--qr-bg`, que deixam o QR sempre preto sobre branco;
- tema escuro.

As ilustrações em `apps/web/public/fotos` são provisórias (geradas por `scripts/gerar-fotos.mjs`) até chegarem as fotos do cadastro (T28).

## API

| Endpoint | Retorno |
|---|---|
| `GET /api/cidadao/premios?categoria=&disponiveis=` | perfil, saldo, prêmios com o motivo de bloqueio para este cidadão |
| `GET /api/cidadao/premios/{id}` | detalhe (sem cache) |
| `POST /api/cidadao/premios/{id}/resgatar` (header `Idempotency-Key`) | `201` com o vale e o saldo; `200` no reenvio (`repetido: true`); `409` com `{erro, bloqueio}`; `422` para chave reaproveitada em outro prêmio |
| `GET /api/cidadao/vales?status=disponiveis\|todos` | vales do cidadão |
| `GET /api/cidadao/vales/{codigo}` | vale. O de outra pessoa dá a mesma resposta de um inexistente (`404`) |

Toda rota usa o usuário da sessão, e toda resposta é validada pelo contrato (`packages/contracts`) antes de sair.

**Observabilidade.**
- Sentry com `SENTRY_DSN` / `VITE_SENTRY_DSN`. CPF, nome, código de vale (`ECO-…` vira `[vale]`) e valores são limpos antes do envio (`packages/observability`).
- Cada resgate gera um log estruturado: `{evento: "resgate", resultado, motivo, premio, duracaoMs}`, sem usuário nem código de vale.

## Estrutura

```
packages/contracts      Zod (zod/mini): prêmio, bloqueio, vale, resgate, erros
packages/regras         regras puras: bloqueio, prazo de retirada, vencido, código do vale
packages/format         pt-BR (1.250 pontos, datas em America/Boa_Vista), rótulos e ícones
packages/tokens         tokens.css
packages/observability  limpeza dos eventos do Sentry
apps/api                Fastify + PostgreSQL (pg ou PGlite), T24 mínimo, resgate, cache
apps/web                Vite + TypeScript sem framework; service worker; QR gerado no aparelho
```

## Vercel

O `vercel.json` faz a Vercel rodar `scripts/vercel-build.mjs`, que gera `.vercel/output`: a página em `/premios/` e a API numa função em `/api/*`.
- **Com `DATABASE_URL`** (ex.: Neon), a função usa o PostgreSQL de verdade e semeia o banco se ele estiver vazio.
- **Sem `DATABASE_URL`**, roda uma demonstração com PGlite em memória: mesmo SQL e mesma transação, mas os dados voltam ao inicial a cada partida a frio.

Na demonstração, todo visitante entra como `cidadao-luz` (`ECO_PESSOA` muda isso).

## Pendências de definição

1. **Gamificação (Fase 3):** no ar ou não. Padrão: a regra do nível mínimo existe, mas só vale com `ECO_GAMIFICACAO=1`. A demonstração liga para mostrar o bloqueio por nível.
2. **Prazo de retirada:** adotado **30 dias**, até o fim do dia em Boa Vista (`DIAS_PARA_RETIRAR`).
3. **Vale vencido devolve os pontos?** Hoje **não**: só muda o status. Se devolver, falta uma rotina que grave o estorno.
4. **Cidadão cancela o próprio vale?** **Não implementado.** A tela leva ao Fale Conosco.
5. **Catador troca prêmios?** Hoje **não**: vê a mensagem do Pix.
6. **Categorias:** adotadas Alimentação, Casa, Lazer e Serviços.
7. **Vale cancelado conta no limite do mês?** Hoje **não conta**. Cancelar também devolve a unidade ao estoque (regra a confirmar no T27).
8. **Livro-razão (T24):** criado aqui na versão mínima. "Meus Pontos" ainda lê de mock e precisa do adaptador PostgreSQL da `LedgerReadPort` lendo `lancamentos` e `saldos`. Sem isso, o estorno do critério 6 não aparece lá.
9. **Autenticação no webview SASI:** como o app entrega a sessão ao canal URL. Hoje: cookie `eco_sessao` ou Bearer, com tokens de desenvolvimento. O servidor não sobe em produção sem isso.
10. **Fotos reais e cadastro (T28), baixa na portaria e cancelamento pela gestão (T27):** fora do escopo. `premios/gestao.ts` tem só a regra, usada pelos dados de exemplo e pelos testes.
11. **Endereços dos outros canais** (Fale Conosco, Meus Pontos): `VITE_LINK_*` no build.
12. **Falha de rede no meio da troca:** a mensagem diz "Seus pontos não foram descontados". Se a resposta se perdeu depois de gravar, a nova tentativa usa a mesma chave e devolve o mesmo vale, sem débito duplo. Revisar o texto com a comunicação.
