import { describe, expect, it } from "vitest";
import m002 from "../../src/lib/db/migrations/002-seed-antigravity-skip-rule.js";
import { DEFAULT_ANTIGRAVITY_CAPACITY_RULE } from "../../src/lib/db/repos/settingsRepo.js";

// Fake adapter: only the settings id=1 row is exercised by the migration.
function makeDb(initialData) {
  let store = initialData == null ? null : JSON.stringify(initialData);
  return {
    get: () => (store == null ? null : { data: store }),
    run: (_sql, params) => { store = params[0]; },
    dump: () => (store == null ? null : JSON.parse(store)),
  };
}

// Seeding is probe-based: it checks whether the two canonical Antigravity capacity-503
// error shapes (MODEL_CAPACITY_EXHAUSTED / "No capacity available for model") are caught
// by the user's rules via the REAL match logic, appends the default only for uncovered
// patterns, and raises sweep:true on a skip rule that catches capacity.
describe("migration 002: seed Antigravity capacity skip-rule (probe-based)", () => {
  it("seeds the default (sweep:true) for legacy installs (empty rules, no flag)", () => {
    const db = makeDb({ providerSkipRules: [], other: 1 });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toEqual([DEFAULT_ANTIGRAVITY_CAPACITY_RULE]);
    expect(d.skipRulesSeeded).toBe(true);
    expect(d.other).toBe(1); // preserves unrelated keys
  });

  it("is idempotent — re-running does not duplicate", () => {
    const db = makeDb({ providerSkipRules: [] });
    m002.up(db);
    m002.up(db);
    expect(db.dump().providerSkipRules).toHaveLength(1);
  });

  it("500+capacity skip does NOT cover 503 → keeps rule 500 and appends default", () => {
    const db = makeDb({
      providerSkipRules: [{ provider: "antigravity", match: { status: 500, contains: "capacity" }, action: "skip" }],
    });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toHaveLength(2);
    expect(d.providerSkipRules[0].match.status).toBe(500); // user rule kept, unchanged
    expect(d.providerSkipRules[1]).toEqual(DEFAULT_ANTIGRAVITY_CAPACITY_RULE);
    expect(d.skipRulesSeeded).toBe(true);
  });

  it("contains-only capacity skip (no status) covers both patterns → raise sweep, no append", () => {
    const db = makeDb({
      providerSkipRules: [{ provider: "antigravity", match: { contains: "capacity" }, action: "skip" }],
    });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toHaveLength(1);
    expect(d.providerSkipRules[0]).toEqual({ provider: "antigravity", match: { contains: "capacity" }, action: "skip", sweep: true });
  });

  it("status-only 503 skip (no contains) covers both patterns → raise sweep, no append", () => {
    const db = makeDb({
      providerSkipRules: [{ provider: "antigravity", match: { status: 503 }, action: "skip" }],
    });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toHaveLength(1);
    expect(d.providerSkipRules[0]).toEqual({ provider: "antigravity", match: { status: 503 }, action: "skip", sweep: true });
  });

  it("503+model_capacity_exhausted skip covers only ONE pattern → raise sweep AND append default", () => {
    const db = makeDb({
      providerSkipRules: [{ provider: "antigravity", match: { status: 503, contains: "model_capacity_exhausted" }, action: "skip" }],
    });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toHaveLength(2);
    // partial rule caught MODEL_CAPACITY_EXHAUSTED → sweep raised
    expect(d.providerSkipRules[0]).toEqual({ provider: "antigravity", match: { status: 503, contains: "model_capacity_exhausted" }, action: "skip", sweep: true });
    // "No capacity available for model" still uncovered → default appended to catch it
    expect(d.providerSkipRules[1]).toEqual(DEFAULT_ANTIGRAVITY_CAPACITY_RULE);
  });

  it("503+capacity RETRY (deliberate user choice) → NOT mutated to skip, no sweep, no append", () => {
    const db = makeDb({
      providerSkipRules: [{ provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "retry" }],
    });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toHaveLength(1); // array-order: retry wins, covers both probes
    expect(d.providerSkipRules[0]).toEqual({ provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "retry" });
    expect(d.providerSkipRules[0].sweep).toBeUndefined();
    expect(d.skipRulesSeeded).toBe(true);
  });

  it("full default already present (sweep:true) → unchanged, no duplicate", () => {
    const db = makeDb({ providerSkipRules: [{ ...DEFAULT_ANTIGRAVITY_CAPACITY_RULE }] });
    m002.up(db);
    const d = db.dump();
    expect(d.providerSkipRules).toEqual([DEFAULT_ANTIGRAVITY_CAPACITY_RULE]);
  });

  it("respects a user who deleted the rule after seeding (flag already set)", () => {
    const db = makeDb({ providerSkipRules: [], skipRulesSeeded: true });
    m002.up(db);
    expect(db.dump().providerSkipRules).toHaveLength(0); // not re-seeded
  });

  it("is a no-op when there is no settings row (DEFAULT_SETTINGS covers fresh DB)", () => {
    const db = makeDb(null);
    m002.up(db);
    expect(db.dump()).toBeNull();
  });
});
