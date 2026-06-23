// MCP Gateway: upstream instances, gateway API keys, and per-key grants.
//
//   mcpInstances  — operator-registered upstream MCP servers (HTTP/SSE/stdio).
//   mcpGatewayKeys — API keys a harness uses to talk to the gateway endpoint.
//   mcpKeyGrants  — which instances a key may see/call.
//
//   The key (mcpGatewayKeys.key) is generated with the same machineId-embedded
//   scheme as apiKeys (sk-{machineId}-{keyId}-{crc8}), but stored in a SEPARATE
//   table so gateway access is independently grantable/revocable.
//
//   JSON-shaped columns (args/env/headers/oauthTokens) are stored as TEXT and
//   parsed by the repos.
const m003McpGateway = {
  version: 3,
  name: "mcp gateway",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcpInstances (
        id          TEXT PRIMARY KEY,
        slug        TEXT UNIQUE NOT NULL,
        title       TEXT,
        kind        TEXT NOT NULL,
        transport   TEXT NOT NULL,
        url         TEXT,
        command     TEXT,
        args        TEXT,
        env         TEXT,
        headers     TEXT,
        oauth       INTEGER DEFAULT 0,
        oauthTokens TEXT,
        enabled     INTEGER DEFAULT 1,
        createdAt   TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_inst_slug ON mcpInstances(slug)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_inst_enabled ON mcpInstances(enabled)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS mcpGatewayKeys (
        id        TEXT PRIMARY KEY,
        name      TEXT,
        key       TEXT UNIQUE NOT NULL,
        machineId TEXT,
        isActive  INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_gwkey ON mcpGatewayKeys(key)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS mcpKeyGrants (
        keyId      TEXT NOT NULL,
        instanceId TEXT NOT NULL,
        PRIMARY KEY (keyId, instanceId)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_grant_key ON mcpKeyGrants(keyId)`);
  },
};
export default m003McpGateway;
