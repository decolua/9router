// SQL dialect helpers — SQLite (default) vs PostgreSQL (DATABASE_URL).

const CAMEL_TABLES = [
  "_meta", "settings", "providerConnections", "providerNodes", "proxyPools",
  "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
];

const CAMEL_COLUMNS = [
  "authType", "isActive", "createdAt", "updatedAt", "machineId", "keyHash",
  "dateKey", "testStatus", "connectionId", "promptTokens", "completionTokens",
  "displayName", "globalPriority", "defaultModel", "accessToken", "refreshToken",
  "expiresAt", "tokenType", "projectId", "apiKey", "lastTested", "lastError",
  "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode", "consecutiveUseCount",
];

function quotePgIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Quote camelCase tables/columns for PostgreSQL (skips already-quoted idents). */
export function quotePgSql(sql) {
  const idents = [...CAMEL_TABLES, ...CAMEL_COLUMNS].sort((a, b) => b.length - a.length);
  // Split on double-quoted strings so DDL like `"key"` is not re-quoted to `""key""`.
  const parts = sql.split(/("(?:[^"]|"")*")/g);
  return parts.map((part) => {
    if (part.startsWith('"')) return part;
    let out = part;
    for (const id of idents) {
      out = out.replace(new RegExp(`\\b${id}\\b`, "g"), quotePgIdent(id));
    }
    return out;
  }).join("");
}

/** Convert SQLite ? placeholders to PostgreSQL $1, $2, … */
export function toPgParams(sql, params = []) {
  let i = 0;
  const q = sql.replace(/\?/g, () => `$${++i}`);
  return { sql: quotePgSql(q), params };
}

export function isPostgresDialect(dialect) {
  return dialect === "postgres";
}
