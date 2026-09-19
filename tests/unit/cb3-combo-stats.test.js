/**
 * CB3 — % sucesso por combo + quebra por membro (rota /api/usage/combo-stats).
 *
 * Binding decision: docs/orchestration/DECISIONS.md D13 (aggregation reads the
 * REAL attribution CB2 wrote: meta.combo on winners + one error:<status> line
 * per failed attempt). Never the old name heuristic, never a fabricated 0%.
 *
 * Seeding goes through the PUBLIC writers only (requestDetail.saveComboAttemptFailure
 * / saveUsageStats + drainPendingUsage) — the same way CB2 proved its lines, so
 * the test fails if the writers stop persisting what the aggregator counts.
 *
 * Auth: the route handler carries NO auth code by design — /api/* is
 * deny-by-default in src/dashboardGuard.js (PROTECTED_API_PATHS "/api/usage"
 * prefix). The guard itself is middleware, tested by the F38 guard suite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const COMBO = "cb3-stack";
const A = { member: "grok/grok-3", provider: "grok", model: "grok-3" };
const B = { member: "glm/glm-4", provider: "glm", model: "glm-4" };

let tempDir;
let db;
let requestDetail;
const originalDataDir = process.env.DATA_DIR;

function resetDbState() {
  const adapter = global._dbAdapter?.instance;
  if (adapter && typeof adapter.close === "function") {
    try { adapter.close(); } catch {}
  }
  if (global._statsEmitter && typeof global._statsEmitter.removeAllListeners === "function") {
    try { global._statsEmitter.removeAllListeners(); } catch {}
  }
  if (global._statsEmitTimers) {
    if (global._statsEmitTimers.update) clearTimeout(global._statsEmitTimers.update);
    if (global._statsEmitTimers.pending) clearTimeout(global._statsEmitTimers.pending);
  }
  for (const key of ["_dbAdapter", "_pendingRequests", "_lastErrorProvider", "_recentRing",
    "_statsEmitter", "_statsEmitTimers", "_pendingUsagePersists"]) {
    delete global[key];
  }
  vi.useRealTimers();
  vi.resetModules();
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cb3-stats-"));
  process.env.DATA_DIR = tempDir;
  resetDbState();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  requestDetail = await import("open-sse/handlers/chatCore/requestDetail.js");
});

afterEach(() => {
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function settle() {
  await db.drainPendingUsage({ timeoutMs: 3000 });
}

/** N winning lines for one member of one combo (public writer, tokens>0). */
async function seedWins({ combo = COMBO, member, provider, model, n, connectionId = "conn-a" }) {
  for (let i = 0; i < n; i++) {
    requestDetail.saveUsageStats({
      provider, model,
      tokens: { prompt_tokens: 2, completion_tokens: 1 },
      connectionId, apiKey: "client-key", endpoint: "/v1/chat/completions",
      metaExtra: { combo, member },
      silent: true,
    });
  }
  await settle();
}

/** N failed attempt lines for one member (public CB2 writer). */
async function seedFailures({ combo = COMBO, member, provider, model, n, status = 429, connectionId = "conn-a" }) {
  for (let i = 0; i < n; i++) {
    requestDetail.saveComboAttemptFailure({
      comboName: combo, member, provider, model,
      attempt: i + 1, status, connectionId,
      apiKey: "client-key", endpoint: "/v1/chat/completions",
    });
  }
  await settle();
}

async function stats({ range } = {}) {
  const { GET } = await import("@/app/api/usage/combo-stats/route.js");
  const url = `http://localhost/api/usage/combo-stats${range ? `?range=${range}` : ""}`;
  const res = await GET({ url });
  return { status: res.status, body: await res.json() };
}

describe("CB3 combo-stats — aggregation over the REAL CB2 attribution", () => {
  it("combo X: A(5×429 + 3 wins) + B(1×500 + 7 wins) → 10/16 success, per-member failure rates", async () => {
    await seedFailures({ ...A, n: 5, status: 429 });
    await seedWins({ ...A, n: 3 });
    await seedFailures({ ...B, n: 1, status: 500, connectionId: "conn-b" });
    await seedWins({ ...B, n: 7, connectionId: "conn-b" });

    const { status, body } = await stats({ range: "24h" });
    expect(status).toBe(200);
    expect(body.combos).toHaveLength(1);

    const combo = body.combos[0];
    expect(combo.combo).toBe(COMBO);
    expect(combo.window).toBe("24h");
    expect(combo.attempts).toBe(16);
    expect(combo.successes).toBe(10);
    expect(combo.failures).toBe(6);
    expect(combo.successRate).toBe(0.625);

    const byMember = Object.fromEntries(combo.members.map((m) => [m.member, m]));
    expect(Object.keys(byMember).sort()).toEqual([B.member, A.member].sort());

    const a = byMember[A.member];
    expect(a.provider).toBe("grok");
    expect(a.model).toBe("grok-3");
    expect(a.attempts).toBe(8);
    expect(a.failures).toBe(5);
    expect(a.failureRate).toBe(0.625);
    expect(a.lastErrorStatus).toBe("error:429");
    expect(typeof a.lastErrorAt).toBe("string");

    const b = byMember[B.member];
    expect(b.attempts).toBe(8);
    expect(b.failures).toBe(1);
    expect(b.failureRate).toBe(0.125);
    expect(b.lastErrorStatus).toBe("error:500");

    // honest source flags: there ARE error lines, no unattributed winners
    expect(body.sources.failuresRecorded).toBe(true);
    expect(body.coverage).toBe("full");
  });

  it("only meta.combo lines are aggregated — legacy winner rows never join a combo by name guess", async () => {
    // CB5/NIT-1: "legacy" is anchored to the ATTRIBUTION EPOCH (first record
    // in the DB whose meta carries a combo), not "any unattributed winner".
    // The direct winner below predates that epoch → honest partial.
    vi.useFakeTimers({ toFake: ["Date"] });
    const NOW = new Date("2026-09-19T12:00:00.000Z");

    vi.setSystemTime(new Date(NOW.getTime() - 2 * 3_600_000));
    // same provider/model as member A, but WITHOUT meta.combo (pre-attribution)
    requestDetail.saveUsageStats({
      provider: A.provider, model: A.model,
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      connectionId: "conn-a", silent: true,
    });
    await settle();

    vi.setSystemTime(NOW);
    await seedFailures({ ...A, n: 2, status: 429 });
    await seedWins({ ...A, n: 1 });

    const { body } = await stats({ range: "24h" });
    const combo = body.combos[0];
    expect(combo.attempts, "the unattributed row must NOT inflate the combo").toBe(3);
    expect(body.coverage, "pre-epoch winners in window → honest partial").toBe("partial");
    expect(body.sources.legacyWinnersWithoutCombo).toBe(1);
    expect(body.sources.attributionEpoch, "epoch = first attributed record's timestamp").toBe(NOW.toISOString());
  });

  it("NIT-1 (REV-D): legit direct traffic AFTER the epoch does not light 'partial'", async () => {
    await seedWins({ ...A, n: 2 }); // establishes the attribution epoch
    // Current unattributed winner — same model, but this is legitimate direct
    // traffic, NOT pre-attribution legacy. Must not flip coverage.
    requestDetail.saveUsageStats({
      provider: A.provider, model: A.model,
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      connectionId: "conn-a", silent: true,
    });
    await settle();

    const { body } = await stats({ range: "24h" });
    expect(body.combos[0].attempts).toBe(2);
    expect(body.coverage, "post-epoch unattributed winners are NOT legacy").toBe("full");
    expect(body.sources.legacyWinnersWithoutCombo).toBe(0);
  });

  it("NIT-1 fallback: no attributed record anywhere → epoch null → nothing can be 'legacy'", async () => {
    requestDetail.saveUsageStats({
      provider: A.provider, model: A.model,
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      connectionId: "conn-a", silent: true,
    });
    await settle();

    const { body } = await stats({ range: "24h" });
    expect(body.combos).toEqual([]);
    expect(body.sources.attributionEpoch).toBe(null);
    expect(body.sources.legacyWinnersWithoutCombo, "no epoch → no pre-epoch rows to count").toBe(0);
    expect(body.coverage).toBe("full");
  });

  it("NIT-2 (REV-D): combo whose member is ANOTHER combo is flagged, never silently undercounting alone", async () => {
    const combosRepo = await import("@/lib/db/repos/combosRepo.js");
    await combosRepo.createCombo({ name: "cb3-inner", models: [A.member] });
    await combosRepo.createCombo({ name: "cb3-outer", models: ["cb3-inner", B.member] });

    // Nested traffic is attributed to the INNER combo only (CB2 rule); the
    // outer combo sees just its real-model member.
    await seedWins({ ...A, n: 3, combo: "cb3-inner" });
    await seedWins({ ...B, n: 1, combo: "cb3-outer" });

    const { body } = await stats({ range: "24h" });
    expect(body.sources.nestedCombos, "aggregate signals the outer combo + its sub-combos").toEqual([
      { combo: "cb3-outer", subCombos: ["cb3-inner"] },
    ]);
    const outer = body.combos.find((c) => c.combo === "cb3-outer");
    expect(outer.nestedSubCombos, "entry carries the names so the badge can render the notice").toEqual(["cb3-inner"]);
    expect(outer.attempts, "NO number is fabricated for the shadowed nested traffic").toBe(1);
    const inner = body.combos.find((c) => c.combo === "cb3-inner");
    expect(inner.nestedSubCombos, "inner combo is not itself nested").toBeUndefined();
  });

  it("NIT-3 (REV-D): last error per member comes from a grouped SQL read (latest wins), capped + truncation-flagged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const NOW = new Date("2026-09-19T12:00:00.000Z");
    vi.setSystemTime(new Date(NOW.getTime() - 3 * 3_600_000));
    await seedFailures({ ...A, n: 2, status: 429 });
    vi.setSystemTime(new Date(NOW.getTime() - 60_000));
    await seedFailures({ ...A, n: 1, status: 503 });
    vi.setSystemTime(NOW);
    await seedFailures({ ...A, n: 1, status: 500 });
    await seedWins({ ...A, n: 1 });
    vi.setSystemTime(NOW);

    const { body } = await stats({ range: "24h" });
    const a = body.combos[0].members[0];
    expect(a.attempts).toBe(5);
    expect(a.failures, "counts still come from the groups SUM, not the error stream").toBe(4);
    expect(a.lastErrorStatus, "GROUP BY + latest-per-member keeps the NEWEST error").toBe("error:500");
    expect(a.lastErrorAt).toBe(NOW.toISOString());
    expect(body.sources.failuresRecorded).toBe(true);
    expect(body.sources.truncated, "well under the group cap → not truncated").toBe(false);

    // The cap flag itself is a pure-shaping contract (assemble receives it from
    // the fetcher when the LIMIT bound is reached).
    const agg = await import("@/lib/comboStats/aggregate.js");
    const cut = agg.assembleComboStats({
      window: { range: "24h", from: "x", to: "y" },
      failureLines: [], failureLinesTruncated: true,
    });
    expect(cut.sources.truncated).toBe(true);
  });

  it("no failure lines in window → failuresRecorded:false, coverage full when nothing is unattributed", async () => {
    await seedWins({ ...A, n: 2 });
    const { body } = await stats({ range: "24h" });
    expect(body.sources.failuresRecorded, "0% would have been a LIE without failure lines; here the source says so").toBe(false);
    expect(body.combos[0].successRate).toBe(1);
    expect(body.coverage).toBe("full");
  });

  it("window: ?range=1h excludes rows older than 1h, ?range=24h counts them; default is 24h", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const T0 = Date.parse("2026-09-19T12:00:00.000Z");
    const NOW = new Date(T0);

    // Old generation: 2h ago → OUT of 1h, IN of 24h.
    vi.setSystemTime(new Date(T0 - 2 * 3_600_000));
    await seedFailures({ ...A, n: 4, status: 429 });

    // Recent generation: at the cutoff instant.
    vi.setSystemTime(NOW);
    await seedFailures({ ...A, n: 1, status: 429 });
    await seedWins({ ...A, n: 2 });

    vi.setSystemTime(NOW);
    const oneHour = await stats({ range: "1h" });
    expect(oneHour.body.combos[0].attempts).toBe(3);
    expect(oneHour.body.combos[0].failures).toBe(1);

    const oneDay = await stats({ range: "24h" });
    expect(oneDay.body.combos[0].attempts).toBe(7);
    expect(oneDay.body.combos[0].failures).toBe(5);

    const dflt = await stats({});
    expect(dflt.body.window.range, "no param → 24h").toBe("24h");
    expect(dflt.body.combos[0].attempts).toBe(7);
  });

  it("attempts===0 → successRate null, never a fabricated 0%/100%", async () => {
    // Empty window: no combo entries invented out of the combo CONFIG.
    const { body } = await stats({ range: "1h" });
    expect(body.combos).toEqual([]);

    // The pure formatter is what the route uses — zero-attempt input must
    // produce null rates, not NaN and not 0.
    const agg = await import("@/lib/comboStats/aggregate.js");
    const entry = agg.comboAggregate({ combo: "ghost", window: "24h", attempts: 0, successes: 0, failures: 0 });
    expect(entry.successRate).toBe(null);
    expect(entry.attempts).toBe(0);
  });

  it("rejects an unknown range with 400 instead of silently defaulting", async () => {
    const { status, body } = await stats({ range: "5w" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/range/i);
  });

  it("merges LIVE member state: breaker OPEN now + testStatus of the member's connections", async () => {
    await seedFailures({ ...A, n: 3, status: 503 });
    await seedWins({ ...B, n: 2, connectionId: "conn-b" });

    // Trip the member-A account breaker for real (public API, threshold 1).
    const cb = await import("open-sse/utils/circuitBreaker.js");
    const name = cb.buildAccountBreakerName({ provider: A.provider, connectionId: "conn-a", model: A.model });
    cb.getCircuitBreaker(name, { failureThreshold: 1 });
    cb.recordFailure(name, { statusCode: 503 });
    try {
      // A connection carrying testStatus, matched by the id the rows stored.
      const { getAdapter } = await import("@/lib/db/driver.js");
      const adb = await getAdapter();
      const nowIso = new Date().toISOString();
      adb.run(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["conn-b", "glm", "apikey", "glm-backup", null, 1, 1, JSON.stringify({ apiKey: "sk-test", testStatus: "active" }), nowIso, nowIso],
      );

      const { body } = await stats({ range: "24h" });
      const byMember = Object.fromEntries(body.combos[0].members.map((m) => [m.member, m]));

      expect(byMember[A.member].breaker, "member OPEN NOW must be in the payload").toBeTruthy();
      expect(byMember[A.member].breaker.state).toBe("OPEN");
      expect(byMember[B.member].breaker?.state ?? null, "no breaker for B → null, not fake CLOSED").toBe(null);

      expect(byMember[B.member].connections).toEqual([
        { id: "conn-b", name: "glm-backup", testStatus: "active" },
      ]);
    } finally {
      cb.resetCircuitBreaker(name);
    }
  });
});
