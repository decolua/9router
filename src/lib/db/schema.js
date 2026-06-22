// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 6;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  users: {
    columns: {
      id: "TEXT PRIMARY KEY",
      email: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      passwordHash: "TEXT",
      role: "TEXT NOT NULL DEFAULT 'member'",
      oidcSub: "TEXT UNIQUE",
      status: "TEXT NOT NULL DEFAULT 'active'",
      mfaEnabled: "INTEGER DEFAULT 0",
      mfaSecret: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
      "CREATE INDEX IF NOT EXISTS idx_users_oidcSub ON users(oidcSub)",
    ],
  },
  userSettings: {
    columns: {
      userId: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  userInvites: {
    columns: {
      id: "TEXT PRIMARY KEY",
      email: "TEXT",
      tokenHash: "TEXT UNIQUE NOT NULL",
      role: "TEXT NOT NULL DEFAULT 'member'",
      createdBy: "TEXT",
      expiresAt: "TEXT",
      usedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_invites_tokenHash ON userInvites(tokenHash)",
    ],
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_userId ON providerConnections(userId)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT",
      key: "TEXT UNIQUE NOT NULL",
      keyHash: "TEXT",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_userId ON apiKeys(userId)",
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_keyhash ON apiKeys(keyHash)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT",
      name: "TEXT NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_combo_userId ON combos(userId)",
      "CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)",
    ],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      userId: "TEXT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_userId ON usageHistory(userId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_userId ON requestDetails(userId)",
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  passwordResetTokens: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      tokenHash: "TEXT UNIQUE NOT NULL",
      expiresAt: "TEXT NOT NULL",
      usedAt: "TEXT",
      createdBy: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_prt_userId ON passwordResetTokens(userId)",
      "CREATE INDEX IF NOT EXISTS idx_prt_expires ON passwordResetTokens(expiresAt)",
    ],
  },
  auditLogs: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      action: "TEXT NOT NULL",
      actorUserId: "TEXT",
      actorEmail: "TEXT",
      targetType: "TEXT",
      targetId: "TEXT",
      ip: "TEXT",
      outcome: "TEXT NOT NULL DEFAULT 'success'",
      meta: "TEXT NOT NULL DEFAULT '{}'",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_audit_ts ON auditLogs(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_audit_action ON auditLogs(action)",
      "CREATE INDEX IF NOT EXISTS idx_audit_actor ON auditLogs(actorUserId)",
    ],
  },
};

export function mapColumnDef(colDef, dialect) {
  if (dialect !== "postgres") return colDef;
  return colDef
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/i, "SERIAL PRIMARY KEY")
    .replace(/\bREAL\b/gi, "DOUBLE PRECISION");
}

function quoteTable(name, dialect) {
  if (dialect !== "postgres") return name;
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteCol(name, dialect) {
  if (dialect !== "postgres") return name;
  return `"${name.replace(/"/g, '""')}"`;
}

export function buildCreateTableSql(name, def, dialect = "sqlite") {
  const cols = Object.entries(def.columns).map(([k, v]) => `${quoteCol(k, dialect)} ${mapColumnDef(v, dialect)}`);
  if (def.primaryKey) cols.push(def.primaryKey.replace(/\bscope\b/g, quoteCol("scope", dialect)).replace(/\bkey\b/g, quoteCol("key", dialect)));
  return `CREATE TABLE IF NOT EXISTS ${quoteTable(name, dialect)} (${cols.join(", ")})`;
}
