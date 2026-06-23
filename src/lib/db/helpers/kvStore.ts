import type { DbAdapter } from "../driver.js";
import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

export interface KvStore {
  get<T = JsonValue>(key: string, fallback?: T | null): Promise<T | null>;
  getAll(): Promise<Record<string, JsonValue>>;
  set(key: string, value: JsonValue): Promise<void>;
  setMany(obj: Record<string, JsonValue>): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function makeKv(scope: string): KvStore {
  return {
    async get<T = JsonValue>(key: string, fallback: T | null = null): Promise<T | null> {
      const db: DbAdapter = await getAdapter();
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
      if (!row || !("value" in row) || typeof row["value"] !== "string") return fallback;
      return parseJson(row["value"], fallback) as T;
    },
    async getAll(): Promise<Record<string, JsonValue>> {
      const db: DbAdapter = await getAdapter();
      const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]);
      const out: Record<string, JsonValue> = {};
      for (const r of rows) {
        if ("key" in r && "value" in r && typeof r["key"] === "string" && typeof r["value"] === "string") {
          out[r["key"]] = parseJson(r["value"]) as JsonValue;
        }
      }
      return out;
    },
    async set(key: string, value: JsonValue): Promise<void> {
      const db: DbAdapter = await getAdapter();
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [scope, key, stringifyJson(value)],
      );
    },
    async setMany(obj: Record<string, JsonValue>): Promise<void> {
      const db: DbAdapter = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          db.run(
            `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
            [scope, k, stringifyJson(v)],
          );
        }
      });
    },
    async remove(key: string): Promise<void> {
      const db: DbAdapter = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
    },
    async clear(): Promise<void> {
      const db: DbAdapter = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
    },
  };
}
