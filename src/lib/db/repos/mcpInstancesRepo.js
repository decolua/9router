import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// JSON-shaped columns in mcpInstances. Parsed on read, stringified on write.
const JSON_COLS = ["args", "env", "headers", "oauthTokens"];

function rowToInstance(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLS) {
    const raw = row[c];
    out[c] = raw == null || raw === "" ? null : safeParse(raw);
  }
  out.oauth = row.oauth === 1 || row.oauth === true;
  out.enabled = row.enabled === 1 || row.enabled === true;
  return out;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function instanceToRow(i) {
  const out = { ...i };
  for (const c of JSON_COLS) {
    const v = out[c];
    out[c] = v == null ? null : (typeof v === "string" ? v : JSON.stringify(v));
  }
  if ("oauth" in out) out.oauth = out.oauth ? 1 : 0;
  if ("enabled" in out) out.enabled = out.enabled === false ? 0 : 1;
  return out;
}

export async function getInstances() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM mcpInstances ORDER BY createdAt ASC`);
  return rows.map(rowToInstance);
}

export async function getInstanceById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]);
  return rowToInstance(row);
}

export async function getInstanceBySlug(slug) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpInstances WHERE slug = ?`, [slug]);
  return rowToInstance(row);
}

export async function getEnabledInstancesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const db = await getAdapter();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.all(
    `SELECT * FROM mcpInstances WHERE id IN (${placeholders}) AND enabled = 1`,
    ids
  );
  return rows.map(rowToInstance);
}

export async function createInstance(data) {
  const db = await getAdapter();
  const inst = instanceToRow({
    id: uuidv4(),
    slug: data.slug,
    title: data.title || null,
    kind: data.kind,
    transport: data.transport || (data.kind === "command" ? "stdio" : (data.kind === "http" || data.kind === "sse" ? data.kind : "stdio")),
    url: data.url || null,
    command: data.command || null,
    args: data.args ?? null,
    env: data.env ?? null,
    headers: data.headers ?? null,
    oauth: !!data.oauth,
    oauthTokens: data.oauthTokens ?? null,
    enabled: data.enabled !== false,
    createdAt: new Date().toISOString(),
  });
  try {
    db.run(
      `INSERT INTO mcpInstances(id, slug, title, kind, transport, url, command, args, env, headers, oauth, oauthTokens, enabled, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inst.id, inst.slug, inst.title, inst.kind, inst.transport,
        inst.url, inst.command, inst.args, inst.env, inst.headers,
        inst.oauth, inst.oauthTokens, inst.enabled, inst.createdAt,
      ]
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      const err = new Error("slug taken");
      err.code = "DUPLICATE_SLUG";
      throw err;
    }
    throw e;
  }
  return rowToInstance(inst);
}

export async function updateInstance(id, data) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]);
  if (!existing) return null;
  const merged = instanceToRow({ ...rowToInstance(existing), ...data });
  try {
    db.run(
      `UPDATE mcpInstances SET
         slug = ?, title = ?, kind = ?, transport = ?, url = ?, command = ?,
         args = ?, env = ?, headers = ?, oauth = ?, oauthTokens = ?, enabled = ?
       WHERE id = ?`,
      [
        merged.slug, merged.title, merged.kind, merged.transport,
        merged.url, merged.command, merged.args, merged.env, merged.headers,
        merged.oauth, merged.oauthTokens, merged.enabled, id,
      ]
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      const err = new Error("slug taken");
      err.code = "DUPLICATE_SLUG";
      throw err;
    }
    throw e;
  }
  return rowToInstance(merged);
}

export async function deleteInstance(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM mcpKeyGrants WHERE instanceId = ?`, [id]);
  const res = db.run(`DELETE FROM mcpInstances WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

function isUniqueViolation(e) {
  const msg = String(e?.message || "");
  return msg.includes("UNIQUE") || msg.includes("constraint failed");
}
