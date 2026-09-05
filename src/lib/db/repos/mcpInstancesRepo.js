import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const JSON_COLS = ["args", "env", "headers", "oauthTokens"];

function rowToInstance(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLS) {
    out[c] = parseJson(row[c], null);
  }
  out.oauth = row.oauth === 1 || row.oauth === true;
  out.enabled = row.enabled === 1 || row.enabled === true;
  return out;
}

function instanceToRow(i) {
  const out = { ...i };
  for (const c of JSON_COLS) {
    if (c in out) out[c] = out[c] != null ? stringifyJson(out[c]) : null;
  }
  if ("oauth" in out) out.oauth = out.oauth ? 1 : 0;
  if ("enabled" in out) out.enabled = out.enabled === false ? 0 : 1;
  return out;
}

function isUniqueViolation(e) {
  const msg = e && typeof e === "object" && "message" in e ? String(e.message) : "";
  return /UNIQUE constraint failed/i.test(msg);
}

export async function getInstances() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM mcpInstances ORDER BY createdAt ASC`).map(rowToInstance).filter((i) => i !== null);
}

export async function getInstanceById(id) {
  const db = await getAdapter();
  return rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]));
}

export async function getInstanceBySlug(slug) {
  const db = await getAdapter();
  return rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE slug = ?`, [slug]));
}

export async function getEnabledInstancesByIds(ids) {
  if (!ids.length) return [];
  const db = await getAdapter();
  const placeholders = ids.map(() => "?").join(",");
  return db.all(
    `SELECT * FROM mcpInstances WHERE enabled = 1 AND id IN (${placeholders})`,
    ids,
  ).map(rowToInstance).filter((i) => i !== null);
}

export async function createInstance(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const inst = {
    ...data,
    id: data.id ?? uuidv4(),
    enabled: data.enabled !== false,
    oauth: data.oauth === true,
    createdAt: now,
  };
  const r = instanceToRow(inst);
  try {
    db.run(
      `INSERT INTO mcpInstances(id, slug, title, kind, transport, url, command, args, env, headers, oauth, oauthTokens, enabled, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.slug, r.title ?? null, r.kind, r.transport, r.url ?? null, r.command ?? null, r.args ?? null, r.env ?? null, r.headers ?? null, r.oauth, r.oauthTokens ?? null, r.enabled, r.createdAt],
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Slug '${inst.slug}' already exists`);
    throw e;
  }
  return rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [inst.id]));
}

export async function updateInstance(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToInstance(row);
    const merged = { ...existing, ...data };
    const r = instanceToRow(merged);
    try {
      db.run(
        `UPDATE mcpInstances SET slug=?, title=?, kind=?, transport=?, url=?, command=?, args=?, env=?, headers=?, oauth=?, oauthTokens=?, enabled=? WHERE id=?`,
        [r.slug, r.title ?? null, r.kind, r.transport, r.url ?? null, r.command ?? null, r.args ?? null, r.env ?? null, r.headers ?? null, r.oauth, r.oauthTokens ?? null, r.enabled, id],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error(`Slug '${r.slug}' already exists`);
      throw e;
    }
    result = rowToInstance(db.get(`SELECT * FROM mcpInstances WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteInstance(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM mcpInstances WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
