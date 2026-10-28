import { getAdapter } from "../driver.js";

const SCOPE = "revokedDashboardSessions";

export async function isDashboardSessionRevoked(digest) {
  const db = await getAdapter();
  return !!db.get("SELECT 1 FROM kv WHERE scope = ? AND key = ?", [SCOPE, digest]);
}

// One row per signed-out token avoids a read/merge/write race between logouts.
// Only expired entries may be pruned: a count cap could resurrect live tokens.
export async function revokeDashboardSession(digest, expiresAt) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run("DELETE FROM kv WHERE scope = ? AND CAST(value AS REAL) <= ?", [
      SCOPE, Math.floor(Date.now() / 1000),
    ]);
    db.run(
      "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
      [SCOPE, digest, JSON.stringify(expiresAt)],
    );
  });
  // Native adapters commit synchronously; sql.js normally debounces disk writes.
  if (db.driver === "sql.js") db.flush();
}
