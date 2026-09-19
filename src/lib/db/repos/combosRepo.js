import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { pruneMembers } from "@/shared/utils/comboModelLinks.js";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers.js";

// Combo `kind` values the runtime actually reads: "llm" (also the implicit
// default when kind is null) plus every media kind id the dashboard lists and
// filters on (src/shared/constants/providers.js, v1/models, webRouting,
// media-providers pages). Widening this set means wiring a kind through those
// consumers first — do not invent values here.
export const COMBO_KINDS = new Set(["llm", ...MEDIA_PROVIDER_KINDS.map((k) => k.id)]);

// Returns an error message, or null when the kind is acceptable.
// null/undefined mean "no kind" (default llm behaviour).
export function comboKindError(kind) {
  if (kind === null || kind === undefined) return null;
  if (typeof kind === "string" && COMBO_KINDS.has(kind)) return null;
  return `Invalid combo kind. Allowed: llm (default), ${[...MEDIA_PROVIDER_KINDS.map((k) => k.id)].join(", ")}`;
}

// Returns an error message, or null when `models` is a usable member list.
// Consumers treat entries as strings ("provider/model" or a nested combo
// name); objects are tolerated for per-member config, anything looser
// (numbers, booleans, arrays, null) would silently break routing/pruning.
export function comboModelsError(models) {
  if (!Array.isArray(models)) {
    return "models must be an array of model strings (or objects), not a bare " + typeof models;
  }
  for (const item of models) {
    if (typeof item === "string" && item.trim() !== "") continue;
    if (item && typeof item === "object" && !Array.isArray(item)) continue;
    return "every model entry must be a non-empty string or an object";
  }
  return null;
}

/**
 * CB2b — semantic validation (complements comboModelsError, which checks only
 * shape): would storing this combo leave IT on a combo→combo cycle?
 *
 * A combo member references another combo when its first "/"-separated token
 * equals a known combo name. Bare "c1" is the real runtime recursion (that is
 * exactly what getComboModels/getComboModelsFromData expand — they refuse
 * slashed names), so those edges are mandatory; "c1/anything" is ambiguous
 * member data a user typed meaning "the combo c1" and is treated as a
 * potential edge. Anything else ("openai/gpt-4o", or a bare name no combo
 * owns) is just a member string and never an edge.
 *
 * Policy, mirroring the CB2 runtime guard (which stays as defence in depth):
 *  - Self-reference (x → x) is ALWAYS rejected, even against an empty DB.
 *  - Detection is an unbounded whole-graph search (BFS with parent chain) over
 *    the graph as it WOULD be after this save, so 3+-node cycles (a → b → c → a)
 *    fail on the save that closes them, not only 2-cycles. Work is capped by
 *    the graph itself (V nodes / E edges via the visited set) — never by a
 *    hand-picked "look N levels" heuristic.
 *  - Only cycles THROUGH the saved combo block the save. A cycle elsewhere in
 *    the final graph (legacy rows written before this check existed) must not
 *    force migrating other combos on every unrelated PUT; the runtime guard
 *    keeps those requests a deterministic 400.
 *
 * `combos` are the OTHER persisted combos; the saved row's final values
 * (`name`, `models`) override anything present under the same name. Returns an
 * error message naming the cycle path, or null when the save is acyclic.
 */
export function comboCycleError(name, models, combos) {
  if (typeof name !== "string" || name.trim() === "") return null;

  const memberRows = new Map();
  for (const combo of combos || []) {
    if (combo && typeof combo.name === "string" && combo.name) memberRows.set(combo.name, combo.models);
  }
  memberRows.set(name, models); // the row being saved, in its FINAL form
  const names = new Set(memberRows.keys());

  const refsCache = new Map();
  const refsOf = (node) => {
    if (refsCache.has(node)) return refsCache.get(node);
    const out = [];
    for (const item of (node === name ? models : memberRows.get(node)) || []) {
      let str = null;
      if (typeof item === "string") str = item.trim();
      else if (item && typeof item === "object" && !Array.isArray(item)) {
        for (const key of ["model", "name", "id"]) {
          if (typeof item[key] === "string" && item[key].trim()) { str = item[key].trim(); break; }
        }
      }
      if (!str) continue;
      const token = str.split("/")[0].trim();
      if (token && names.has(token) && !out.includes(token)) out.push(token);
    }
    refsCache.set(node, out);
    return out;
  };

  // BFS from the saved combo: a cycle through it means the saved name is
  // reachable again from itself. `visited` caps node expansions at V and refs
  // are scanned once per node (E) — O(V+E) by construction; the size test is
  // pure belt-and-braces, never hit on well-formed data.
  const parent = new Map();
  const queue = [name];
  const visited = new Set([name]);
  let closingFrom = null;
  while (queue.length > 0 && closingFrom === null) {
    const node = queue.shift();
    for (const next of refsOf(node)) {
      if (next === name) { closingFrom = node; break; }
      if (visited.has(next)) continue;
      if (visited.size > names.size) break;
      visited.add(next);
      parent.set(next, node);
      queue.push(next);
    }
  }
  if (closingFrom === null) return null;

  if (closingFrom === name) {
    return `Combo "${name}" cannot contain itself (self-reference)`;
  }
  const chain = [];
  for (let x = closingFrom; x && x !== name; x = parent.get(x)) chain.unshift(x);
  return `Combo cycle detected: ${[name, ...chain, name].join(" -> ")} — remove the reference that closes it`;
}

// A combo name UNIQUE violation as surfaced by the SQLite drivers
// ("UNIQUE constraint failed: combos.name") — the same detection pattern
// usageRepo.js uses. Callers map this to a 400 instead of a 500 when their
// get-by-name pre-check lost a race against a concurrent INSERT/UPDATE.
export function isComboNameConflict(error) {
  const msg = String(error?.message || "");
  return msg.includes("UNIQUE constraint failed") && msg.includes("name");
}

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Remove a model from every combo that uses it, and clear any fusion judge
 * naming it, in ONE transaction.
 *
 * A loop over updateCombo would be transactional per combo, so a failure
 * midway would leave some combos pruned and others not — a partial edit to
 * the user's saved routing. The judge lives in the settings row, which is in
 * the same database, so one transaction covers both.
 *
 * @param {string[]} candidates - every name form the model may be stored under
 * @returns {Promise<Array<{id, name, removed, remainingCount, judgeCleared}>>}
 */
export async function removeModelFromCombos(candidates) {
  const set = new Set((candidates || []).filter(Boolean));
  if (set.size === 0) return [];

  const db = await getAdapter();
  const summary = [];

  db.transaction(() => {
    const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
    const now = new Date().toISOString();
    const byName = new Map();

    for (const row of rows) {
      const combo = rowToCombo(row);
      byName.set(combo.name, combo);
      const { kept, removed } = pruneMembers(combo.models, set);
      if (removed.length === 0) continue;
      db.run(
        `UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?`,
        [stringifyJson(kept), now, combo.id]
      );
      summary.push({
        id: combo.id,
        name: combo.name,
        removed,
        remainingCount: kept.length,
        judgeCleared: false,
      });
    }

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = settingsRow ? parseJson(settingsRow.data, {}) : {};
    const strategies = settings.comboStrategies;
    if (!strategies || typeof strategies !== "object") return;

    let strategiesChanged = false;
    for (const [comboName, config] of Object.entries(strategies)) {
      if (!config || !set.has(config.judgeModel)) continue;
      strategies[comboName] = { ...config, judgeModel: null };
      strategiesChanged = true;
      const existing = summary.find((entry) => entry.name === comboName);
      if (existing) {
        existing.judgeCleared = true;
      } else {
        const combo = byName.get(comboName);
        summary.push({
          id: combo?.id ?? null,
          name: comboName,
          removed: [],
          remainingCount: combo ? combo.models.length : null,
          judgeCleared: true,
        });
      }
    }

    if (strategiesChanged) {
      db.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stringifyJson({ ...settings, comboStrategies: strategies })]
      );
    }
  });

  return summary;
}
