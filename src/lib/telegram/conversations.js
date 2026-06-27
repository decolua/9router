// Conversation memory + per-chat default model.
// Reuses the existing kv table (scope, key, value PRIMARY KEY (scope, key)).
// scope is namespaced by tg_msgs:<chatId> and tg_state:<chatId>.

import { getAdapter } from "@/lib/db/driver.js";

const MAX_HISTORY = 20; // last N messages kept per chat
const SCOPE_MSGS = (chatId) => `tg_msgs:${chatId}`;
const SCOPE_STATE = (chatId) => `tg_state:${chatId}`;

async function db() {
  return getAdapter();
}

export async function getHistory(chatId) {
  const a = await db();
  const rows = a.all(
    "SELECT key, value FROM kv WHERE scope = ? ORDER BY CAST(key AS INTEGER) ASC",
    [SCOPE_MSGS(chatId)]
  );
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.value);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function appendMessage(chatId, role, content) {
  const a = await db();
  const scope = SCOPE_MSGS(chatId);
  const ts = Date.now();
  a.run(
    "INSERT OR REPLACE INTO kv (scope, key, value) VALUES (?, ?, ?)",
    [scope, String(ts), JSON.stringify({ role, content, ts })]
  );

  // Trim to last MAX_HISTORY entries.
  const rows = a.all(
    "SELECT key FROM kv WHERE scope = ? ORDER BY CAST(key AS INTEGER) DESC",
    [scope]
  );
  if (rows.length > MAX_HISTORY) {
    const toDelete = rows.slice(MAX_HISTORY).map((r) => r.key);
    for (const k of toDelete) {
      a.run("DELETE FROM kv WHERE scope = ? AND key = ?", [scope, k]);
    }
  }
}

export async function clearHistory(chatId) {
  const a = await db();
  a.run("DELETE FROM kv WHERE scope = ?", [SCOPE_MSGS(chatId)]);
}

export async function getDefaultModel(chatId) {
  const a = await db();
  const row = a.get(
    "SELECT value FROM kv WHERE scope = ? AND key = ?",
    [SCOPE_STATE(chatId), "model"]
  );
  if (row?.value) return row.value;
  return process.env.TELEGRAM_DEFAULT_MODEL || "kr/claude-sonnet-4.5";
}

export async function setDefaultModel(chatId, model) {
  const a = await db();
  a.run(
    "INSERT OR REPLACE INTO kv (scope, key, value) VALUES (?, ?, ?)",
    [SCOPE_STATE(chatId), "model", String(model)]
  );
}
