-- Request details (observability) stored in PostgreSQL instead of SQLite.
CREATE TABLE IF NOT EXISTS request_details (
  id TEXT PRIMARY KEY,
  provider TEXT,
  model TEXT,
  connection_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  status TEXT,
  latency TEXT,
  tokens TEXT,
  request TEXT,
  provider_request TEXT,
  provider_response TEXT,
  response TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_details_timestamp ON request_details(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_request_details_provider ON request_details(provider);
CREATE INDEX IF NOT EXISTS idx_request_details_model ON request_details(model);
CREATE INDEX IF NOT EXISTS idx_request_details_connection ON request_details(connection_id);
CREATE INDEX IF NOT EXISTS idx_request_details_status ON request_details(status);
