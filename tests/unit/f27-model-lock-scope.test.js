// F27 / RM5 — activation-driven modelLock reset must be model-scopable.
//
// Findings docs/orchestration/findings/T1.1.md §M5 (live re-read):
// resetHealthStateOnActivation() nulls EVERY modelLock_* key of a connection
// whenever a patch carries testStatus:"active" — no notion of "the model of
// this request". Two reachable damage classes:
//  * a per-model caller (e.g. POST /api/models/availability {action:
//    "clearCooldown", model} → updateProviderConnection({modelLock_M: null,
//    testStatus: "active", ...}), or the 401-refresh activation path) silently
//    unlocks OTHER models — quota locks with resetAt hours away included, so
//    the gateway starts hammering exhausted models again.
//  * the API has no way to say "scope this activation to model M".
//
// Fix contract: optional modelLockScope param — when provided (or when the
// patch itself declares specific modelLock_* keys) only those locks reset;
// the legacy call shape (patch has testStatus but no lock declarations, no
// scope) keeps wiping everything (account re-activation semantics preserved).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { captured, currentRow } = vi.hoisted(() => ({
  captured: { lastRun: null },
  currentRow: { value: null },
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    get: () => currentRow.value,
    all: () => (currentRow.value ? [currentRow.value] : []),
    run: (sql, params) => {
      captured.lastRun = { sql, params };
      // reflect the write so a re-read sees the merged row
      const [, , , , , , , dataJson, ,] = params;
      currentRow.value = { ...currentRow.value, data: dataJson };
    },
    transaction: (fn) => fn(),
  }),
}));

const repo = await import("../../src/lib/db/repos/connectionsRepo.js");

const FUTURE = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(); // 5 h lock
const FUTURE2 = new Date(Date.now() + 90 * 60 * 1000).toISOString();    // 90 min lock

function makeRow() {
  return {
    id: "conn-1",
    provider: "antigravity",
    authType: "oauth",
    name: "acc",
    email: "a@b.c",
    priority: 1,
    isActive: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    data: JSON.stringify({
      accessToken: "AT-old",
      modelLock_gemini_pro: FUTURE,
      modelLock_claude_sonnet: FUTURE2,
    }),
  };
}

beforeEach(() => {
  captured.lastRun = null;
  currentRow.value = makeRow();
});

describe("A — resetHealthStateOnActivation scoping (pure)", () => {
  it("legacy shape: activation with no lock declarations still wipes every modelLock_*", () => {
    const out = repo.resetHealthStateOnActivation(
      JSON.parse(JSON.stringify({ modelLock_gemini_pro: FUTURE, modelLock_claude_sonnet: FUTURE2 })),
      { testStatus: "active", accessToken: "AT-new" }
    );
    expect(out.accessToken).toBe("AT-new");
    expect(out.modelLock_gemini_pro).toBe(null);
    expect(out.modelLock_claude_sonnet).toBe(null);
  });

  it("scope param: activation scoped to one model resets ONLY that model's lock", () => {
    const existing = { modelLock_gemini_pro: FUTURE, modelLock_claude_sonnet: FUTURE2 };
    const out = repo.resetHealthStateOnActivation(
      existing,
      { testStatus: "active", accessToken: "AT-new" },
      "gemini_pro"
    );
    expect(out.modelLock_gemini_pro).toBe(null);
    // The persisted row is {...existing, ...normalized}: the sibling key must NOT
    // be force-nulled by the reset — i.e. absent from normalized (RED: today the
    // wipe-all loop puts modelLock_claude_sonnet: null into the patch).
    expect("modelLock_claude_sonnet" in out).toBe(false);
    expect({ ...existing, ...out }.modelLock_claude_sonnet).toBe(FUTURE2);
  });

  it("patch-declared locks: a per-model clearCooldown patch does not nuke sibling locks", () => {
    // Shape sent by POST /api/models/availability {action:"clearCooldown", model}
    const existing = { modelLock_gemini_pro: FUTURE, modelLock_claude_sonnet: FUTURE2 };
    const out = repo.resetHealthStateOnActivation(
      existing,
      { testStatus: "active", modelLock_gemini_pro: null, lastError: null, errorCode: null, lastErrorAt: null, backoffLevel: 0 }
    );
    expect(out.modelLock_gemini_pro).toBe(null); // explicit in patch
    expect("modelLock_claude_sonnet" in out).toBe(false); // RED: today force-nulled
    expect({ ...existing, ...out }.modelLock_claude_sonnet).toBe(FUTURE2);
  });

  it("non-activation patches pass through untouched", () => {
    const patch = { accessToken: "AT-x" };
    expect(repo.resetHealthStateOnActivation({ modelLock_gemini_pro: FUTURE }, patch)).toBe(patch);
  });
});

describe("B — updateProviderConnection gains the optional model scope", () => {
  it("2-arg legacy call preserves wipe-all behavior", async () => {
    const res = await repo.updateProviderConnection("conn-1", { testStatus: "active", accessToken: "AT-new" });
    expect(res.modelLock_gemini_pro).toBe(null);
    expect(res.modelLock_claude_sonnet).toBe(null); // legacy = account-wide reset
  });

  it("3-arg { modelLockScope } resets only the request's model and leaks no scope field", async () => {
    const res = await repo.updateProviderConnection(
      "conn-1",
      { testStatus: "active", accessToken: "AT-new" },
      { modelLockScope: "gemini_pro" }
    );
    expect(res.modelLock_gemini_pro).toBe(null);
    // RED: no 3rd-arg support today → both locks wiped.
    expect(res.modelLock_claude_sonnet).toBe(FUTURE2);
    expect("modelLockScope" in res).toBe(false);
  });
});
