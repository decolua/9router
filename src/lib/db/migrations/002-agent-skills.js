// Adds the agentSkills table to a database already stamped at version 1.
//
// 001 creates every table in TABLES, so a fresh database gets this one from
// there — but 001 never re-runs on an existing install, which is what this
// migration is for. CREATE TABLE IF NOT EXISTS keeps both paths safe.
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 2,
  name: "agent-skills",
  up(db) {
    const def = TABLES.agentSkills;
    db.exec(buildCreateTableSql("agentSkills", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
};
