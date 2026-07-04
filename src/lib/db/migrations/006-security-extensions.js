// Migration 006: MFA fields, password reset tokens.

import { TABLES, buildCreateTableSql, mapColumnDef } from "../schema.js";
import { qAll, qExec } from "../query.js";

export async function securityExtensionsPostgres(adapter) {
  const existing = await qAll(
    adapter,
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
    ["users"],
  );
  const names = new Set(existing.map((r) => r.name));
  const lower = new Set(existing.map((r) => r.name.toLowerCase()));

  if (!names.has("mfaEnabled") && !lower.has("mfaenabled")) {
    await qExec(
      adapter,
      `ALTER TABLE "users" ADD COLUMN "mfaEnabled" ${mapColumnDef("INTEGER DEFAULT 0", "postgres")}`
    );
    console.log("[DB][migrate] 006: added users.mfaEnabled");
  }
  if (!names.has("mfaSecret") && !lower.has("mfasecret")) {
    await qExec(adapter, `ALTER TABLE "users" ADD COLUMN "mfaSecret" TEXT`);
    console.log("[DB][migrate] 006: added users.mfaSecret");
  }

  const def = TABLES.passwordResetTokens;
  await qExec(adapter, buildCreateTableSql("passwordResetTokens", def, "postgres"));
  for (const idx of def.indexes || []) {
    const pgIdx = idx.replace(/ ON (\w+)\(/g, (_, table) => ` ON "${table}"(`);
    try { await qExec(adapter, pgIdx); } catch {}
  }
}

export default {
  version: 6,
  name: "security-extensions",
  up(db) {
    const dialect = db.dialect || "sqlite";
    const quote = (name) => (dialect === "postgres" ? `"${name}"` : name);

    try {
      db.exec(`ALTER TABLE ${quote("users")} ADD COLUMN ${quote("mfaEnabled")} INTEGER DEFAULT 0`);
    } catch {
      // column may already exist via schema sync
    }
    try {
      db.exec(`ALTER TABLE ${quote("users")} ADD COLUMN ${quote("mfaSecret")} TEXT`);
    } catch {
      // column may already exist via schema sync
    }

    const def = TABLES.passwordResetTokens;
    db.exec(buildCreateTableSql("passwordResetTokens", def, dialect));
    for (const idx of def.indexes || []) db.exec(idx);
  },
  upPostgres: securityExtensionsPostgres,
};
