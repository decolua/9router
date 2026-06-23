import type { DbAdapter } from "../driver.js";
import { getAdapter } from "../driver.js";

export async function getMeta(key: string, fallback: string | null = null) {
  const db: DbAdapter = await getAdapter();
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  if (!row || !("value" in row) || typeof row["value"] !== "string") return fallback;
  return row["value"];
}

export async function setMeta(key: string, value: string | number) {
  const db: DbAdapter = await getAdapter();
  db.run(
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)],
  );
}

// Sync versions for use during migration (adapter passed directly)
export function getMetaSync(adapter: DbAdapter, key: string, fallback: string | null = null) {
  const row = adapter.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  if (!row || !("value" in row) || typeof row["value"] !== "string") return fallback;
  return row["value"];
}

export function setMetaSync(adapter: DbAdapter, key: string, value: string | number) {
  adapter.run(
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)],
  );
}
