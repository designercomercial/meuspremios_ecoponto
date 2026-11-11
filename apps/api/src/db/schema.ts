/**
 * Esquema do banco.
 *
 * T24 – livro-razão de pontos (mínimo, criado aqui porque ainda não existia):
 *   lancamentos  só recebe INSERT; cada movimento de pontos é uma linha.
 *   saldos       saldo guardado, atualizado na MESMA transação de cada
 *                lançamento. CHECK (pontos >= 0): o banco recusa saldo negativo.
 *
 * Prêmios (T25/T26/T28):
 *   premios               catálogo; CHECK (estoque >= 0).
 *   vales                 um por resgate; código único.
 *   resgate_idempotencia  (usuario_id, chave) único: o mesmo pedido nunca
 *                         gera dois vales.
 *
 * "vencido" não é gravado: é calculado na leitura (vale disponível com prazo
 * passado), então não depende de rotina agendada.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS cidadaos (
  id      text PRIMARY KEY,
  ref     text NOT NULL UNIQUE,
  perfil  text NOT NULL CHECK (perfil IN ('cidadao', 'catador')),
  nivel   integer NOT NULL DEFAULT 1 CHECK (nivel >= 1)
);

-- ---------------------------------------------------------------- T24
CREATE TABLE IF NOT EXISTS saldos (
  usuario_id     text PRIMARY KEY REFERENCES cidadaos (id),
  pontos         integer NOT NULL DEFAULT 0 CONSTRAINT saldo_nao_negativo CHECK (pontos >= 0),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id           bigserial PRIMARY KEY,
  usuario_id   text NOT NULL REFERENCES cidadaos (id),
  tipo         text NOT NULL CHECK (tipo IN (
                 'entrega', 'bonus_campanha', 'resgate', 'estorno', 'doacao',
                 'credito_luz_enviado', 'credito_luz_devolvido', 'pix_entrega')),
  direcao      text NOT NULL CHECK (direcao IN ('credito', 'debito')),
  pontos       integer NOT NULL CHECK (pontos > 0),
  descricao    text NOT NULL,
  vale_id      text NULL,
  -- Quem lançou, quando não é o próprio sistema (ex.: gestor que cancelou).
  autor        text NULL,
  ocorrido_em  timestamptz NOT NULL,
  CHECK ((tipo IN ('resgate', 'doacao', 'credito_luz_enviado')) = (direcao = 'debito'))
);
CREATE INDEX IF NOT EXISTS lancamentos_usuario_em ON lancamentos (usuario_id, ocorrido_em DESC);
-- Um débito e no máximo um estorno por vale.
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_resgate_unico ON lancamentos (vale_id) WHERE tipo = 'resgate';
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_estorno_unico ON lancamentos (vale_id) WHERE tipo = 'estorno';

-- ---------------------------------------------------------------- Prêmios
CREATE TABLE IF NOT EXISTS premios (
  id              text PRIMARY KEY,
  nome            text NOT NULL,
  descricao       text NOT NULL,
  foto_url        text NOT NULL,
  categoria       text NOT NULL CHECK (categoria IN ('alimentacao', 'casa', 'lazer', 'servicos')),
  custo           integer NOT NULL CHECK (custo > 0),
  estoque         integer NOT NULL CONSTRAINT estoque_nao_negativo CHECK (estoque >= 0),
  limite_por_mes  integer NULL CHECK (limite_por_mes > 0),
  nivel_minimo    integer NULL CHECK (nivel_minimo > 0),
  oferta_ate      timestamptz NULL,
  ativo           boolean NOT NULL DEFAULT false,
  onde_retirar    text NOT NULL DEFAULT 'Na portaria de qualquer ecoponto, com o vale aberto no celular.',
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vales (
  id                 text PRIMARY KEY,
  codigo             text NOT NULL UNIQUE,
  usuario_id         text NOT NULL REFERENCES cidadaos (id),
  premio_id          text NOT NULL REFERENCES premios (id),
  custo              integer NOT NULL CHECK (custo > 0),
  status             text NOT NULL CHECK (status IN ('disponivel', 'retirado', 'cancelado')),
  resgatado_em       timestamptz NOT NULL,
  retirar_ate        timestamptz NOT NULL,
  retirado_em        timestamptz NULL,
  retirado_ecoponto  text NULL,
  retirado_por       text NULL,
  cancelado_em       timestamptz NULL,
  cancelado_por      text NULL,
  CHECK ((status = 'retirado') = (retirado_em IS NOT NULL AND retirado_ecoponto IS NOT NULL)),
  CHECK ((status = 'cancelado') = (cancelado_em IS NOT NULL AND cancelado_por IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS vales_usuario_premio_em ON vales (usuario_id, premio_id, resgatado_em);
CREATE INDEX IF NOT EXISTS vales_usuario_em ON vales (usuario_id, resgatado_em DESC);

CREATE TABLE IF NOT EXISTS resgate_idempotencia (
  usuario_id  text NOT NULL REFERENCES cidadaos (id),
  chave       text NOT NULL,
  premio_id   text NOT NULL,
  -- Preenchido na mesma transação; ninguém de fora vê a linha sem o vale.
  vale_id     text NULL REFERENCES vales (id),
  criado_em   timestamptz NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);
`;
