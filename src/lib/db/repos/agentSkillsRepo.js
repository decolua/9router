import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

/**
 * Agent skills — third-party SKILL.md documents appended to the system prompt
 * of routed requests.
 *
 * The document BODY is stored here rather than fetched per request: a routed
 * completion must not depend on GitHub being reachable, and re-fetching on
 * every call would add a network round trip to the hot path.
 */

function rowToSkill(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    enabled: row.enabled === 1 || row.enabled === true,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function skillToRow(s) {
  const { id, enabled, sortOrder, createdAt, updatedAt, ...rest } = s;
  return {
    id,
    enabled: enabled ? 1 : 0,
    sortOrder: sortOrder ?? 0,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, s) {
  const r = skillToRow(s);
  db.run(
    `INSERT INTO agentSkills(id, enabled, sortOrder, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled=excluded.enabled, sortOrder=excluded.sortOrder,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.enabled, r.sortOrder, r.data, r.createdAt, r.updatedAt],
  );
}

export async function getAgentSkills() {
  const db = await getAdapter();
  const list = db.all(`SELECT * FROM agentSkills`, []).map(rowToSkill);
  list.sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name || "").localeCompare(String(b.name || "")));
  return list;
}

/** Only what the request path needs: enabled skills, in order. */
export async function getEnabledAgentSkills() {
  const db = await getAdapter();
  const list = db.all(`SELECT * FROM agentSkills WHERE enabled = 1`, []).map(rowToSkill);
  list.sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name || "").localeCompare(String(b.name || "")));
  return list;
}

export async function getAgentSkillById(id) {
  const db = await getAdapter();
  return rowToSkill(db.get(`SELECT * FROM agentSkills WHERE id = ?`, [id]));
}

export async function createAgentSkill(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const skill = {
    id: data.id || uuidv4(),
    name: data.name,
    description: data.description || "",
    sourceUrl: data.sourceUrl || "",
    rawUrl: data.rawUrl || "",
    license: data.license || "",
    body: data.body || "",
    bytes: data.body ? Buffer.byteLength(data.body, "utf8") : 0,
    fetchedAt: now,
    // Off on arrival: adding a skill must not silently change every request.
    enabled: data.enabled === true,
    sortOrder: data.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, skill);
  return skill;
}

export async function updateAgentSkill(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM agentSkills WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToSkill(row), ...data, updatedAt: new Date().toISOString() };
    if (typeof merged.body === "string") merged.bytes = Buffer.byteLength(merged.body, "utf8");
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteAgentSkill(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM agentSkills WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToSkill(row);
    db.run(`DELETE FROM agentSkills WHERE id = ?`, [id]);
  });
  return removed;
}
