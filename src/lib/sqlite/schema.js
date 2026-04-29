// Schema DDL inlined as a JS string so it ships inside the JS bundle —
// avoids fs.readFileSync against a sibling file, which breaks under Next's
// standalone output (file tracing skips non-JS assets).
//
// Source of truth is still `schema.sql` next to this file; if you edit one,
// keep the other in sync. The SQL text below is identical to schema.sql.

export const SCHEMA_SQL = `
-- 9Router SQLite schema v1
-- Hybrid model: hot fields as columns, flexible fields as JSON TEXT.

-- Config tables (from db.json) -------------------------------------------

CREATE TABLE IF NOT EXISTS provider_connections (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  auth_type    TEXT,
  name         TEXT,
  priority     INTEGER,
  is_active    INTEGER NOT NULL DEFAULT 1,
  data         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_provider ON provider_connections(provider);
CREATE INDEX IF NOT EXISTS idx_pc_priority ON provider_connections(provider, priority);

CREATE TABLE IF NOT EXISTS provider_nodes (
  id           TEXT PRIMARY KEY,
  type         TEXT,
  name         TEXT,
  prefix       TEXT,
  api_type     TEXT,
  base_url     TEXT,
  data         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proxy_pools (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  proxy_url    TEXT,
  type         TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  data         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS combos (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  data         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  key          TEXT NOT NULL,
  machine_id   TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apikeys_key ON api_keys(key);

-- Key-value entities (map-shaped in original JSON) -----------------------

CREATE TABLE IF NOT EXISTS model_aliases (
  alias        TEXT PRIMARY KEY,
  target       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mitm_aliases (
  tool         TEXT PRIMARY KEY,
  data         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_models (
  provider_alias TEXT NOT NULL,
  id             TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'llm',
  name           TEXT,
  PRIMARY KEY (provider_alias, id, type)
);

CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing (
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  data         TEXT NOT NULL,
  PRIMARY KEY (provider, model)
);

-- Usage tables (from usage.json) -----------------------------------------

CREATE TABLE IF NOT EXISTS usage_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp         TEXT NOT NULL,
  provider          TEXT,
  model             TEXT,
  connection_id     TEXT,
  api_key           TEXT,
  endpoint          TEXT,
  status            TEXT,
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost              REAL DEFAULT 0,
  data              TEXT
);
CREATE INDEX IF NOT EXISTS idx_hist_ts       ON usage_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hist_provider ON usage_history(provider, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hist_model    ON usage_history(model, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hist_conn     ON usage_history(connection_id, timestamp DESC);

-- daily_summary stored as one row per (date, bucket, key). \`data\` holds
-- the JSON meta originally sitting alongside counters (rawModel, provider,
-- endpoint, apiKey).
CREATE TABLE IF NOT EXISTS daily_summary (
  date_key          TEXT NOT NULL,
  bucket            TEXT NOT NULL,    -- 'day' | 'byProvider' | 'byModel' | 'byAccount' | 'byApiKey' | 'byEndpoint'
  key               TEXT NOT NULL,    -- '_' for the day-level totals row
  requests          INTEGER DEFAULT 0,
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost              REAL DEFAULT 0,
  data              TEXT,
  PRIMARY KEY (date_key, bucket, key)
);
CREATE INDEX IF NOT EXISTS idx_daily_datekey ON daily_summary(date_key);

CREATE TABLE IF NOT EXISTS meta (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL
);

-- Request details (from request-details.json) ----------------------------

CREATE TABLE IF NOT EXISTS request_details (
  id                TEXT PRIMARY KEY,
  timestamp         TEXT NOT NULL,
  provider          TEXT,
  model             TEXT,
  connection_id     TEXT,
  status            TEXT,
  latency_ms        INTEGER,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  data              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rd_ts       ON request_details(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rd_provider ON request_details(provider, timestamp DESC);

-- Request log (replaces ~/.9router/log.txt). One row per request entry.
-- Trimmed periodically to keep the table small.
CREATE TABLE IF NOT EXISTS request_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp         TEXT NOT NULL,
  model             TEXT,
  provider          TEXT,
  account           TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  status            TEXT
);
CREATE INDEX IF NOT EXISTS idx_reqlog_id_desc ON request_log(id DESC);
`;
