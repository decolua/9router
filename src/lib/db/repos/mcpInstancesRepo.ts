import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "../driver.js";
import { getAdapter } from "../driver.js";

export type McpInstance = Record<string, unknown> & {
  id: string;
  slug: string;
  enabled: boolean;
  oauth: boolean;
};

const JSON_COLS = ["args", "env", "headers", "oauthTokens"] as const;

function safeParse(s: unknown): unknown {
  if (typeof s !== "string") return null;
  try { return JSON.parse(s); } catch { return null; }
}

function rowToInstance(row: Record<string, unknown> | undefined): McpInstance | null {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row };
  for (const c of JSON_COLS) {
    out[c] = safeParse(row[c]);
  }
  out["oauth"] = row["oauth"] === 1 || row["oauth"] === true;
  out["enabled"] = row["enabled"] === 1 || row["enabled"] === true;
  return out as McpInstance;
}

function instanceToRow(i: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...i };
  for (const c of JSON_COLS) {
    if (c in out) out[c] = out[c] != null ? JSON.stringify(out[c]) : null;
  }
  if ("oauth" in out) out["oauth"] = out["oauth"] ? 1 : 0;
  if ("enabled" in out) out["enabled"] = out["enabled"] === false ? 0 : 1;
  return out;
}

export async function getInstances() {
  const db: DbAdapter = await getAdapter();
  return db.all(`SELECT * FROM mcpInstances ORDER BY createdAt ASC`).map(rowToInstance).filter((i): i is McpInstance => i !== null);
}

export async function getInstanceById(id: string) {
  const db: DbAdapter = await getAdapter();
  return rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]));
}

export async function getInstanceBySlug(slug: string) {
  const db: DbAdapter = await getAdapter();
  return rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE slug = ?`, [slug]));
}

export async function getEnabledInstancesByIds(ids: string[]) {
  if (!ids.length) return [];
  const db: DbAdapter = await getAdapter();
  const placeholders = ids.map(() => "?").join(",");
  return db.all(
    `SELECT * FROM mcpInstances WHERE enabled = 1 AND id IN (${placeholders})`,
    ids,
  ).map(rowToInstance).filter((i): i is McpInstance => i !== null);
}

function isUniqueViolation(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  return /UNIQUE constraint failed/i.test(msg);
}

export async function createInstance(data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  const now = new Date().toISOString();
  const inst: Record<string, unknown> = {
    ...data,
    id: (data["id"] as string | undefined) ?? uuidv4(),
    enabled: data["enabled"] !== false,
    oauth: data["oauth"] === true,
    createdAt: now,
  };
  const r = instanceToRow(inst);
  try {
    db.run(
      `INSERT INTO mcpInstances(id, slug, title, kind, transport, url, command, args, env, headers, oauth, oauthTokens, enabled, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r["id"], r["slug"], r["title"] ?? null, r["kind"], r["transport"], r["url"] ?? null, r["command"] ?? null, r["args"] ?? null, r["env"] ?? null, r["headers"] ?? null, r["oauth"], r["oauthTokens"] ?? null, r["enabled"], r["createdAt"]],
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Slug '${inst["slug"]}' already exists`);
    throw e;
  }
  return rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [inst["id"]]));
}

export async function updateInstance(id: string, data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  let result: McpInstance | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToInstance(row) as Record<string, unknown>;
    const merged = { ...existing, ...data };
    const r = instanceToRow(merged);
    try {
      db.run(
        `UPDATE mcpInstances SET slug=?, title=?, kind=?, transport=?, url=?, command=?, args=?, env=?, headers=?, oauth=?, oauthTokens=?, enabled=? WHERE id=?`,
        [r["slug"], r["title"] ?? null, r["kind"], r["transport"], r["url"] ?? null, r["command"] ?? null, r["args"] ?? null, r["env"] ?? null, r["headers"] ?? null, r["oauth"], r["oauthTokens"] ?? null, r["enabled"], id],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error(`Slug '${r["slug"]}' already exists`);
      throw e;
    }
    result = rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteInstance(id: string) {
  const db: DbAdapter = await getAdapter();
  const res = db.run(`DELETE FROM mcpInstances WHERE id = ?`, [id]);
  return ((res as { changes?: number } | undefined)?.changes ?? 0) > 0;
}
