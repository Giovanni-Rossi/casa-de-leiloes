CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('leiloeiro', 'licitante')),
  balance_cents BIGINT      NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache local dos itens da API externa: mantém a busca e a criação de lotes
-- funcionando quando a API cai.
CREATE TABLE IF NOT EXISTS catalog_items (
  external_id TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  image_url   TEXT,
  description TEXT,
  attributes  JSONB NOT NULL DEFAULT '{}',
  source_url  TEXT,
  cached_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id                  SERIAL PRIMARY KEY,
  seller_id           INT    NOT NULL REFERENCES users(id),
  external_id         TEXT,
  title               TEXT   NOT NULL,
  description         TEXT,
  image_url           TEXT,
  attributes          JSONB  NOT NULL DEFAULT '{}',
  source_url          TEXT,
  starting_bid_cents  BIGINT NOT NULL CHECK (starting_bid_cents > 0),
  min_increment_cents BIGINT NOT NULL CHECK (min_increment_cents > 0),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  original_ends_at    TIMESTAMPTZ NOT NULL,
  -- active: aguardando/rodando (a fase ao vivo/agendado/encerrado deriva do relógio);
  -- settled: liquidado; cancelled: cancelado.
  status              TEXT   NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'cancelled')),
  current_bid_cents   BIGINT,
  leader_id           INT REFERENCES users(id),
  bid_count           INT    NOT NULL DEFAULT 0,
  head_hash           TEXT,
  winner_id           INT REFERENCES users(id),
  final_cents         BIGINT,
  settled_at          TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS lots_status_ends_idx ON lots (status, ends_at);
CREATE INDEX IF NOT EXISTS lots_leader_idx ON lots (leader_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bids (
  id         SERIAL PRIMARY KEY,
  lot_id     INT    NOT NULL REFERENCES lots(id),
  seq        INT    NOT NULL,
  bidder_id  INT    NOT NULL REFERENCES users(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_ms BIGINT NOT NULL,
  prev_hash  TEXT   NOT NULL,
  hash       TEXT   NOT NULL,
  UNIQUE (lot_id, seq)
);
CREATE INDEX IF NOT EXISTS bids_bidder_idx ON bids (bidder_id);

CREATE TABLE IF NOT EXISTS transactions (
  id           SERIAL PRIMARY KEY,
  user_id      INT    NOT NULL REFERENCES users(id),
  lot_id       INT    REFERENCES lots(id),
  type         TEXT   NOT NULL CHECK (type IN ('deposit', 'debit', 'credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  id           SERIAL PRIMARY KEY,
  lot_id       INT    NOT NULL UNIQUE REFERENCES lots(id),
  token        TEXT   NOT NULL UNIQUE,
  winner_id    INT    NOT NULL REFERENCES users(id),
  seller_id    INT    NOT NULL REFERENCES users(id),
  amount_cents BIGINT NOT NULL,
  bid_count    INT    NOT NULL,
  head_hash    TEXT   NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defesa em profundidade: o histórico de lances é append-only também no nível do banco.
-- Um superusuário pode desabilitar o trigger, mas aí a cadeia de HMAC denuncia a adulteração.
CREATE OR REPLACE FUNCTION bids_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bids é append-only (% bloqueado)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bids_no_update ON bids;
CREATE TRIGGER bids_no_update BEFORE UPDATE OR DELETE ON bids
  FOR EACH ROW EXECUTE FUNCTION bids_append_only();
