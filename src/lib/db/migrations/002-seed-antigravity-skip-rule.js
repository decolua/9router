// One-time seed of the default Antigravity capacity skip-rule for EXISTING installs.
//
// Fresh DBs get the rule from DEFAULT_SETTINGS. Installs created before this feature
// have a settings row with providerSkipRules:[] (or absent) and no skipRulesSeeded
// flag — and mergeWithDefaults only fills keys that are `undefined`, so it would never
// backfill the rule. This migration seeds it exactly once via the shared helper.
//
// The seeding logic lives in settingsRepo.seedAntigravityRule so this migration and
// the legacy-db.json import path (migrate.js) behave identically. It is idempotent,
// only adds the rule when no capacity-equivalent antigravity rule exists (an unrelated
// antigravity rule like 429→retry does NOT block it), and respects a user who later
// deletes the rule (the flag stays set).
import { seedAntigravityRule } from "../repos/settingsRepo.js";

export default {
  version: 2,
  name: "seed-antigravity-skip-rule",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return; // no settings row yet → DEFAULT_SETTINGS covers fresh installs

    let data;
    try {
      data = JSON.parse(row.data) || {};
    } catch {
      return; // unreadable settings blob → leave untouched
    }

    if (data.skipRulesSeeded) return; // already seeded (or fresh) → respect user state

    seedAntigravityRule(data);

    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify(data)]
    );
  },
};
