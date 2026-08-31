// Build a portable UPSERT. Replaces SQLite's `INSERT OR REPLACE INTO ...`,
// which Postgres does not support, with an explicit
// `INSERT ... ON CONFLICT (<conflict>) DO UPDATE SET <rest> = EXCLUDED.<rest>`.
//
//   upsertSql("apiKeys", ["id", "key", "name"], ["id"])
//     → INSERT INTO apiKeys(id, key, name) VALUES(?, ?, ?)
//       ON CONFLICT(id) DO UPDATE SET key = EXCLUDED.key, name = EXCLUDED.name
export function upsertSql(table, columns, conflictColumns) {
  const conflict = new Set(conflictColumns);
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((c) => !conflict.has(c))
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  const tail = updates
    ? `DO UPDATE SET ${updates}`
    : "DO NOTHING";
  return (
    `INSERT INTO ${table}(${columns.join(", ")}) VALUES(${placeholders}) ` +
    `ON CONFLICT(${conflictColumns.join(", ")}) ${tail}`
  );
}
