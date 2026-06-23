import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "../driver.js";
import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
] as const;

export type ProviderConnection = Record<string, unknown> & {
  id: string;
  provider: string;
  authType: string;
  name: string | null;
  email: string | null;
  priority: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function rowToConn(row: Record<string, unknown> | undefined): ProviderConnection | null {
  if (!row) return null;
  const extra = parseJson(typeof row["data"] === "string" ? row["data"] : null, {}) as Record<string, unknown>;
  return {
    ...extra,
    id: row["id"] as string,
    provider: row["provider"] as string,
    authType: row["authType"] as string,
    name: (row["name"] as string | null) ?? null,
    email: (row["email"] as string | null) ?? null,
    priority: typeof row["priority"] === "number" ? row["priority"] : null,
    isActive: row["isActive"] === 1 || row["isActive"] === true,
    createdAt: row["createdAt"] as string,
    updatedAt: row["updatedAt"] as string,
  };
}

function connToRow(c: Record<string, unknown>) {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  return {
    id, provider, authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    data: stringifyJson(rest as JsonValue),
    createdAt, updatedAt,
  };
}

function upsert(db: DbAdapter, c: Record<string, unknown>) {
  const r = connToRow(c);
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt],
  );
}

export async function getProviderConnections(filter: { provider?: string; isActive?: boolean } = {}) {
  const db: DbAdapter = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  const sql = `SELECT * FROM providerConnections${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = db.all(sql, params);
  const list = rows.map(rowToConn).filter((c): c is ProviderConnection => c !== null);
  list.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  return list;
}

export async function getProviderConnectionById(id: string) {
  const db: DbAdapter = await getAdapter();
  return rowToConn(db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]));
}

function reorderInTx(db: DbAdapter, providerId: string) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [providerId])
    .map(rowToConn).filter((c): c is ProviderConnection => c !== null);
  list.sort((a, b) => {
    const pDiff = (a.priority ?? 0) - (b.priority ?? 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
  });
  list.forEach((c, i) => {
    db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, c.id]);
  });
}

export async function createProviderConnection(data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  const now = new Date().toISOString();
  let result: ProviderConnection | undefined;

  db.transaction(() => {
    const all = db.all(`SELECT * FROM providerConnections WHERE provider = ?`, [data["provider"]])
      .map(rowToConn).filter((c): c is ProviderConnection => c !== null);

    let existing: ProviderConnection | undefined;
    if (data["authType"] === "oauth" && data["email"]) {
      const incomingWs = (data["providerSpecificData"] as Record<string, unknown> | undefined)?.["chatgptAccountId"];
      existing = all.find((c) => {
        if (c.authType !== "oauth" || c.email !== data["email"]) return false;
        const existingWs = (c["providerSpecificData"] as Record<string, unknown> | undefined)?.["chatgptAccountId"];
        if (incomingWs && existingWs) return incomingWs === existingWs;
        return true;
      });
    } else if (data["authType"] === "apikey" && data["name"]) {
      existing = all.find((c) => c.authType === "apikey" && c.name === data["name"]);
    }

    if (existing) {
      const merged = { ...existing, ...data, updatedAt: now };
      upsert(db, merged);
      result = rowToConn(db.get(`SELECT * FROM providerConnections WHERE id = ?`, [existing.id])) ?? undefined;
      return;
    }

    let connectionName = (data["name"] as string | undefined) ?? null;
    if (!connectionName && (data["authType"] === "oauth" || data["authType"] === "access_token")) {
      connectionName = (data["email"] as string | undefined) ?? `Account ${all.length + 1}`;
    }
    let connectionPriority = data["priority"] as number | undefined;
    if (!connectionPriority) {
      connectionPriority = all.reduce((m, c) => Math.max(m, c.priority ?? 0), 0) + 1;
    }

    const conn: Record<string, unknown> = {
      id: uuidv4(),
      provider: data["provider"],
      authType: data["authType"] ?? "oauth",
      name: connectionName,
      priority: connectionPriority,
      isActive: data["isActive"] !== undefined ? data["isActive"] : true,
      createdAt: now,
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
    }
    const psd = data["providerSpecificData"] as Record<string, unknown> | undefined;
    if (psd && Object.keys(psd).length > 0) conn["providerSpecificData"] = psd;
    if (data["email"] !== undefined) conn["email"] = data["email"];

    upsert(db, conn);
    reorderInTx(db, data["provider"] as string);
    result = rowToConn(db.get(`SELECT * FROM providerConnections WHERE id = ?`, [conn["id"]])) ?? undefined;
  });

  return result ?? null;
}

export async function updateProviderConnection(id: string, data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  let result: ProviderConnection | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) { result = null; return; }
    const existing = rowToConn(row);
    if (!existing) return;
    const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    if (data["priority"] !== undefined) reorderInTx(db, existing.provider);
    result = rowToConn(db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteProviderConnection(id: string) {
  const db: DbAdapter = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const row = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [id]);
    if (!row || typeof row["provider"] !== "string") return;
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    reorderInTx(db, row["provider"]);
    ok = true;
  });
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId: string) {
  const db: DbAdapter = await getAdapter();
  const before = db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [providerId]);
  const n = before && "n" in before && typeof before["n"] === "number" ? before["n"] : 0;
  db.run(`DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
  return n;
}

export async function reorderProviderConnections(providerId: string) {
  const db: DbAdapter = await getAdapter();
  db.transaction(() => reorderInTx(db, providerId));
}

export async function cleanupProviderConnections() {
  const db: DbAdapter = await getAdapter();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    for (const row of rows) {
      const conn = rowToConn(row) as Record<string, unknown> | null;
      if (!conn) continue;
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      const psd = conn["providerSpecificData"] as Record<string, unknown> | undefined;
      if (psd && Object.keys(psd).length === 0) {
        delete conn["providerSpecificData"];
        cleaned++;
        dirty = true;
      }
      if (dirty) upsert(db, conn);
    }
  });
  return cleaned;
}
