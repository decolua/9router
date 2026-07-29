import { spawn } from "node:child_process";
import { getAdapter } from "./driver.js";
import { TABLES } from "./schema.js";
import { qAll, qRun, qTransaction } from "./query.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";

const BACKUP_FORMAT = "ebrouter-backup-v2";
const TABLE_NAMES = Object.keys(TABLES);

export function getDatabaseInfo() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return {
      driver: "unconfigured",
      display: "DATABASE_URL not set",
      exportFormat: null,
    };
  }

  try {
    const normalized = url.replace(/^postgres:/, "postgresql:");
    const parsed = new URL(normalized);
    const host = parsed.hostname || "localhost";
    const port = parsed.port || "5432";
    const database = parsed.pathname?.replace(/^\//, "") || "ebrouter";
    return {
      driver: "postgres",
      display: `${host}:${port}/${database}`,
      exportFormat: "sql",
    };
  } catch {
    return {
      driver: "postgres",
      display: "PostgreSQL",
      exportFormat: "sql",
    };
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteTable(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteColumn(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function pgDumpViaCli(connectionString) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "pg_dump",
      [connectionString, "--clean", "--if-exists", "--no-owner", "--no-acl"],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
    });
  });
}

export async function exportPostgresSql() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  try {
    const dumped = await pgDumpViaCli(connectionString);
    return dumped;
  } catch (cliError) {
    console.warn("[DB][backup] pg_dump unavailable, using in-app SQL export:", cliError.message);
  }

  const db = await getAdapter();
  if (db.dialect !== "postgres") {
    throw new Error("PostgreSQL backup requires a PostgreSQL database");
  }

  const lines = [
    "-- ebRouter PostgreSQL backup",
    `-- Generated: ${new Date().toISOString()}`,
    "BEGIN;",
    "SET session_replication_role = replica;",
  ];

  for (const tableName of TABLE_NAMES) {
    const rows = await qAll(db, `SELECT * FROM ${quoteTable(tableName)}`);
    if (!rows.length) continue;

    lines.push("");
    lines.push(`-- Table: ${tableName}`);
    lines.push(`DELETE FROM ${quoteTable(tableName)};`);

    for (const row of rows) {
      const columns = Object.keys(row).map(quoteColumn).join(", ");
      const values = Object.values(row).map(sqlLiteral).join(", ");
      lines.push(`INSERT INTO ${quoteTable(tableName)} (${columns}) VALUES (${values});`);
    }
  }

  lines.push("SET session_replication_role = DEFAULT;");
  lines.push("COMMIT;");
  lines.push("");
  return lines.join("\n");
}

export async function exportFullDbJson() {
  const db = await getAdapter();
  const tables = {};

  for (const tableName of TABLE_NAMES) {
    tables[tableName] = await qAll(db, `SELECT * FROM ${quoteTable(tableName)}`);
  }

  return {
    format: BACKUP_FORMAT,
    dialect: db.dialect,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export async function createBackupDownload() {
  const info = getDatabaseInfo();
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");

  if (info.driver === "postgres") {
    const sql = await exportPostgresSql();
    return {
      content: sql,
      filename: `ebrouter-backup-${stamp}.sql`,
      contentType: "application/sql; charset=utf-8",
      format: "sql",
    };
  }

  const payload = await exportLegacyDbJson();
  return {
    content: JSON.stringify(payload, null, 2),
    filename: `ebrouter-backup-${stamp}.json`,
    contentType: "application/json; charset=utf-8",
    format: "json",
  };
}

export async function exportLegacyDbJson() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: (await qAll(db, `SELECT * FROM providerConnections`)).map((r) => ({
      ...parseJson(r.data, {}),
      id: r.id,
      provider: r.provider,
      authType: r.authType,
      name: r.name,
      email: r.email,
      priority: r.priority,
      isActive: r.isActive === 1 || r.isActive === true,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    providerNodes: (await qAll(db, `SELECT * FROM providerNodes`)).map((r) => ({
      ...parseJson(r.data, {}),
      id: r.id,
      type: r.type,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    proxyPools: (await qAll(db, `SELECT * FROM proxyPools`)).map((r) => ({
      ...parseJson(r.data, {}),
      id: r.id,
      isActive: r.isActive === 1 || r.isActive === true,
      testStatus: r.testStatus,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    apiKeys: (await qAll(db, `SELECT * FROM apiKeys`)).map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      machineId: r.machineId,
      isActive: r.isActive === 1 || r.isActive === true,
      createdAt: r.createdAt,
    })),
    combos: (await qAll(db, `SELECT * FROM combos`)).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      models: parseJson(r.models, []),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of await qAll(db, `SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
    out.modelAliases[r.key] = parseJson(r.value);
  }
  for (const r of await qAll(db, `SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
    out.customModels.push(parseJson(r.value));
  }
  for (const r of await qAll(db, `SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) {
    out.mitmAlias[r.key] = parseJson(r.value);
  }
  for (const r of await qAll(db, `SELECT key, value FROM kv WHERE scope = 'pricing'`)) {
    out.pricing[r.key] = parseJson(r.value);
  }

  return out;
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("--"));
}

async function restorePostgresSqlViaCli(connectionString, sqlText) {
  return new Promise((resolve, reject) => {
    const proc = spawn("psql", [connectionString, "-v", "ON_ERROR_STOP=1"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `psql exited with code ${code}`));
    });
    proc.stdin.write(sqlText);
    proc.stdin.end();
  });
}

async function importPostgresSql(sqlText) {
  const db = await getAdapter();
  if (db.dialect !== "postgres") {
    throw new Error("SQL restore requires PostgreSQL");
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    try {
      await restorePostgresSqlViaCli(connectionString, sqlText);
      return;
    } catch (cliError) {
      console.warn("[DB][backup] psql restore unavailable, using in-app SQL import:", cliError.message);
    }
  }

  const statements = splitSqlStatements(sqlText);
  if (!statements.length) {
    throw new Error("Backup SQL file is empty");
  }

  await qTransaction(db, async (tx) => {
    for (const statement of statements) {
      await qRun(tx, statement);
    }
  });
}

async function importFullDbJson(payload) {
  const db = await getAdapter();
  const tables = payload.tables || {};

  await qTransaction(db, async (tx) => {
    if (db.dialect === "postgres") {
      const tableList = TABLE_NAMES.map(quoteTable).join(", ");
      await qRun(tx, `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    } else {
      for (const tableName of [...TABLE_NAMES].reverse()) {
        await qRun(tx, `DELETE FROM ${quoteTable(tableName)}`);
      }
    }

    for (const tableName of TABLE_NAMES) {
      const rows = tables[tableName] || [];
      for (const row of rows) {
        const columns = Object.keys(row).map(quoteColumn).join(", ");
        const placeholders = Object.keys(row).map(() => "?").join(", ");
        await qRun(
          tx,
          `INSERT INTO ${quoteTable(tableName)} (${columns}) VALUES (${placeholders})`,
          Object.values(row)
        );
      }
    }
  });
}

async function importLegacyDbJson(payload) {
  const db = await getAdapter();

  await qTransaction(db, async (tx) => {
    await qRun(tx, `DELETE FROM settings`);
    await qRun(tx, `DELETE FROM providerConnections`);
    await qRun(tx, `DELETE FROM providerNodes`);
    await qRun(tx, `DELETE FROM proxyPools`);
    await qRun(tx, `DELETE FROM apiKeys`);
    await qRun(tx, `DELETE FROM combos`);
    await qRun(tx, `DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    if (payload.settings) {
      const { getDefaultOrgId } = await import("./repos/organizationsRepo.js");
      const orgId = (await getDefaultOrgId()) || "legacy";
      await qRun(
        tx,
        `INSERT INTO settings(orgId, data) VALUES(?, ?) ON CONFLICT(orgId) DO UPDATE SET data = excluded.data`,
        [orgId, stringifyJson(payload.settings)],
      );
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      await qRun(
        tx,
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           authType = excluded.authType,
           name = excluded.name,
           email = excluded.email,
           priority = excluded.priority,
           isActive = excluded.isActive,
           data = excluded.data,
           createdAt = excluded.createdAt,
           updatedAt = excluded.updatedAt`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }

    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      await qRun(
        tx,
        `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           name = excluded.name,
           data = excluded.data,
           createdAt = excluded.createdAt,
           updatedAt = excluded.updatedAt`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }

    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      await qRun(
        tx,
        `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           isActive = excluded.isActive,
           testStatus = excluded.testStatus,
           data = excluded.data,
           createdAt = excluded.createdAt,
           updatedAt = excluded.updatedAt`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }

    for (const k of payload.apiKeys || []) {
      await qRun(
        tx,
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           key = excluded.key,
           name = excluded.name,
           machineId = excluded.machineId,
           isActive = excluded.isActive,
           createdAt = excluded.createdAt`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }

    for (const c of payload.combos || []) {
      await qRun(
        tx,
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           kind = excluded.kind,
           models = excluded.models,
           createdAt = excluded.createdAt,
           updatedAt = excluded.updatedAt`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }

    for (const [alias, model] of Object.entries(payload.modelAliases || {})) {
      await qRun(
        tx,
        `INSERT INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [alias, stringifyJson(model)]
      );
    }

    for (const m of payload.customModels || []) {
      const key = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      await qRun(
        tx,
        `INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [key, stringifyJson(m)]
      );
    }

    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      await qRun(
        tx,
        `INSERT INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [tool, stringifyJson(mappings || {})]
      );
    }

    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      await qRun(
        tx,
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(models || {})]
      );
    }
  });
}

export async function importBackup(input) {
  if (typeof input === "string") {
    await importPostgresSql(input);
    return;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid database backup");
  }

  if (input.format === BACKUP_FORMAT && input.tables) {
    await importFullDbJson(input);
    return;
  }

  await importLegacyDbJson(input);
}
