import type { JsonValue } from "open-sse/types/executor.js";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export type Combo = {
  id: string;
  name: string;
  kind: string | null;
  models: unknown[];
  createdAt: string;
  updatedAt: string;
};

function rowToCombo(row: Record<string, unknown> | undefined): Combo | null {
  if (!row) return null;
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    kind: (row["kind"] as string) ?? null,
    models: parseJson(row["models"] as string | null, []) as unknown[],
    createdAt: row["createdAt"] as string,
    updatedAt: row["updatedAt"] as string,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`) as Record<string, unknown>[];
  return rows.map(rowToCombo);
}

export async function getComboById(id: string) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
  return rowToCombo(row);
}

export async function getComboByName(name: string) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]) as Record<string, unknown> | undefined;
  return rowToCombo(row);
}

export async function createCombo(data: { name: string; kind?: string | null; models?: unknown[] }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo: Combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind ?? null,
    models: data.models ?? [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models as JsonValue), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id: string, data: Partial<Combo>) {
  const db = await getAdapter();
  let result: Combo | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
    if (!row) return;
    const merged = { ...rowToCombo(row)!, ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson((merged.models ?? []) as JsonValue), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id: string) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]) as { changes?: number } | undefined;
  return (res?.changes ?? 0) > 0;
}
