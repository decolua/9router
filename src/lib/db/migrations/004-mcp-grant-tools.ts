import type { Migration } from "./001-initial.js";

const m004McpGrantTools: Migration = {
  version: 4,
  name: "mcp grant tool allowlist",
  up(db) {
    try {
      db.exec(`ALTER TABLE mcpKeyGrants ADD COLUMN toolAllowlist TEXT`);
    } catch (e) {
      if (!/duplicate column name/i.test(String((e as Error)?.message ?? ""))) throw e;
    }
  },
};
export default m004McpGrantTools;
