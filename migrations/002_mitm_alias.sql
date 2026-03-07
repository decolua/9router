-- MITM alias storage (tool_name -> mappings JSON)
CREATE TABLE IF NOT EXISTS mitm_alias (
  tool_name VARCHAR(255) PRIMARY KEY,
  mappings JSONB DEFAULT '{}'::jsonb
);
