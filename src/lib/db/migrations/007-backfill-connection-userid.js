// Migration 007: restore userId on providerConnections wiped by updateProviderConnection
// (rowToConn omitted userId, so any connection update persisted userId=NULL).

import { qGet, qRun } from "../query.js";

const TENANT_TABLES = [
  "providerConnections",
  "apiKeys",
  "combos",
  "usageHistory",
  "requestDetails",
];

async function backfillNullUserIds(db) {
  const admin = await qGet(
    db,
    `SELECT id FROM users WHERE role = 'admin' ORDER BY "createdAt" ASC LIMIT 1`,
  );
  if (!admin?.id) return;

  for (const table of TENANT_TABLES) {
    await qRun(
      db,
      `UPDATE "${table}" SET "userId" = ? WHERE "userId" IS NULL OR "userId" = ''`,
      [admin.id],
    );
  }
}

export default {
  version: 7,
  name: "backfill-connection-userid",
  up(db) {
    const admin = db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY createdAt ASC LIMIT 1`);
    if (!admin?.id) return;
    for (const table of TENANT_TABLES) {
      db.run(`UPDATE ${table} SET userId = ? WHERE userId IS NULL OR userId = ''`, [admin.id]);
    }
  },
  upPostgres: backfillNullUserIds,
};
