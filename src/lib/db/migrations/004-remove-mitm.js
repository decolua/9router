// 004: remove all MITM feature data. The MITM HTTPS-interception feature
// (DNS hijack of tool hosts + self-signed Root CA installed into OS trust
// stores) is being removed from the app entirely. Its persisted state lives
// in the kv table under scope 'mitmAlias' (PK (scope, key), tool name as key)
// and in the single settings row (a JSON blob). Delete the kv rows and strip
// every mitm* / dnsToolEnabled key from the settings blob so stale state can
// never reactivate a removed feature. Pure DELETE/UPDATE, no DDL — safe inside
// the transactional wrapper (unlike 003 which needs VACUUM).
const migration = {
  version: 8,
  name: "remove-mitm",
  transactional: true,
  up(db) {
    // Drop all kv rows with scope = 'mitmAlias' (per-tool alias mappings).
    db.run(`DELETE FROM kv WHERE scope = 'mitmAlias'`);

    // Strip MITM keys from the settings JSON blob (single row, id = 1).
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (row && row.data) {
      let parsed = null;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        parsed = null; // leave non-JSON blob untouched
      }
      if (parsed && typeof parsed === "object") {
        let changed = false;
        for (const key of Object.keys(parsed)) {
          if (key.startsWith("mitm") || key === "dnsToolEnabled") {
            delete parsed[key];
            changed = true;
          }
        }
        if (changed) {
          db.run(`UPDATE settings SET data = ? WHERE id = 1`, [JSON.stringify(parsed)]);
        }
      }
    }
  },
};

export default migration;