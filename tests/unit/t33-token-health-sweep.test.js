/**
 * T3.3 — proactive OAuth refresh sweep (spec OMNIROUTE-DIFF T-C).
 *
 * Drives runTokenHealthTick with injected deps (connections, refresher,
 * persisters, clock). The due decision and failure classification run through
 * the REAL open-sse helpers (shouldRefreshCredentials / getCredentialExpiryMs /
 * isUnrecoverableRefreshError) via the lazy core import, so this file also
 * pins the race contract with the F26 reactive path: both call
 * refreshProviderCredentials, which wraps withCredentialRefreshLock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  canRefreshNow,
  isOAuthRefreshCandidate,
  buildSuccessPersistPayload,
  BACKOFF_MS,
  PRESERVE_REFRESH_TOKEN_PROVIDERS,
} from "../../src/lib/tokenHealth/refreshCircuit.js";
import { resetHealthStateOnActivation } from "../../src/lib/db/repos/connectionsRepo.js";

const NOW = Date.parse("2026-11-02T00:00:00.000Z");
const MIN = 60_000;

function oauthConn(overrides = {}) {
  return {
    id: "c1",
    provider: "nimbus", // unregistered provider → default 5min refresh lead
    authType: "oauth",
    accessToken: "at-1",
    refreshToken: "rt-1",
    expiresAt: new Date(NOW + 9 * MIN).toISOString(),
    isActive: true,
    ...overrides,
  };
}

function makeClock(start = NOW) {
  const clock = { at: start };
  return { now: () => clock.at, advance: (ms) => { clock.at += ms; } };
}

/**
 * In-memory row store: the fake patchConnection merges the PSD delta over the
 * stored object exactly like the production defaultPatch does, so the backoff
 * ladder (attempts carry-over) is observable across ticks.
 */
function makeHarness({ connections, refresh } = {}) {
  const rows = (connections || []).map((c) => ({ ...c }));
  const clock = makeClock();
  const patches = [];
  const persists = [];
  const refreshSpy = vi.fn(refresh || (async () => null));

  const load = async () => rows.map((r) => ({
    ...r,
    providerSpecificData: r.providerSpecificData ? { ...r.providerSpecificData } : r.providerSpecificData,
  }));

  const patchConnection = async (id, patch) => {
    patches.push({ id, patch });
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const { providerSpecificData, ...rest } = patch;
    Object.assign(row, rest);
    if (providerSpecificData) {
      row.providerSpecificData = { ...(row.providerSpecificData || {}), ...providerSpecificData };
    }
  };

  const persistCredentials = async (id, conn, refreshed) => {
    persists.push({ id, conn, refreshed });
    return true;
  };

  const tick = () => import("../../src/lib/tokenHealth/scheduler.js")
    .then((m) => m.runTokenHealthTick({
      now: clock.now,
      loadConnections: load,
      refresh: refreshSpy,
      persistCredentials,
      patchConnection,
      sleep: async () => {},
    }));

  return { rows, clock, patches, persists, refreshSpy, tick };
}

describe("token health sweep — proactive renewal", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("renews a token 9 minutes before expiry (10min window, beyond the 5min provider lead)", async () => {
    const h = makeHarness({
      connections: [oauthConn()],
      refresh: async () => ({ accessToken: "at-2", refreshToken: "rt-2", expiresIn: 3600 }),
    });
    const res = await h.tick();
    expect(res.refreshed).toBe(1);
    expect(h.refreshSpy).toHaveBeenCalledTimes(1);
    expect(h.persists).toHaveLength(1);
    expect(h.persists[0].refreshed.accessToken).toBe("at-2");
    expect(h.patches).toHaveLength(0);
  });

  it("does not renew while the token is outside both the provider lead and the window", async () => {
    const h = makeHarness({
      connections: [oauthConn({ expiresAt: new Date(NOW + 11 * MIN).toISOString() })],
    });
    const res = await h.tick();
    expect(res.attempted).toBe(0);
    expect(h.refreshSpy).not.toHaveBeenCalled();
  });

  it("skips non-oauth and refreshToken-less connections", async () => {
    const h = makeHarness({
      connections: [
        oauthConn({ authType: "apikey" }),
        oauthConn({ id: "c2", authType: "oauth", refreshToken: "" }),
      ],
    });
    const res = await h.tick();
    expect(res.attempted).toBe(0);
    expect(h.refreshSpy).not.toHaveBeenCalled();
  });

  it("respects the persisted circuit until: no attempts inside the backoff window", async () => {
    const h = makeHarness({
      connections: [oauthConn({
        providerSpecificData: {
          keepMe: 1,
          refreshCircuit: { until: new Date(NOW + 4 * MIN).toISOString(), attempts: 1 },
        },
      })],
      refresh: async () => ({ accessToken: "at-2", expiresIn: 3600 }),
    });
    let res = await h.tick();
    expect(res.attempted).toBe(0);
    expect(h.refreshSpy).not.toHaveBeenCalled();

    h.clock.advance(5 * MIN); // past circuit.until → one shot at renewal
    res = await h.tick();
    expect(res.refreshed).toBe(1);
  });

  it("invalid_grant on a rotating provider: circuit opens, RT is never wiped, never persisted", async () => {
    expect(PRESERVE_REFRESH_TOKEN_PROVIDERS.has("claude")).toBe(true);
    const h = makeHarness({
      // claude lead is 4h → due on every tick; expiry 3h59m away keeps the
      // whole ladder on the pre-expiry (persisted-circuit) path.
      connections: [oauthConn({
        provider: "claude",
        expiresAt: new Date(NOW + 239 * MIN).toISOString(),
        providerSpecificData: { keepMe: 1 },
      })],
      refresh: async () => ({ error: "invalid_grant", unrecoverable: true }),
    });

    await h.tick();
    expect(h.persists).toHaveLength(0); // no credential write at all on failure
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].patch.providerSpecificData.refreshCircuit).toEqual({
      until: new Date(NOW + BACKOFF_MS[0]).toISOString(),
      attempts: 1,
    });

    h.clock.advance(BACKOFF_MS[0]);
    await h.tick();
    expect(h.patches[1].patch.providerSpecificData.refreshCircuit.attempts).toBe(2);
    expect(Date.parse(h.patches[1].patch.providerSpecificData.refreshCircuit.until))
      .toBe(NOW + BACKOFF_MS[0] + BACKOFF_MS[1]);

    h.clock.advance(BACKOFF_MS[1]);
    await h.tick();
    expect(h.patches[2].patch.providerSpecificData.refreshCircuit.attempts).toBe(3);

    // No write ever carries a refreshToken key — the stored RT survives intact.
    for (const { patch } of h.patches) expect(patch).not.toHaveProperty("refreshToken");
    expect(h.persists).toHaveLength(0);
    // Sibling providerSpecificData keys survive the delta merge.
    expect(h.rows[0].providerSpecificData.keepMe).toBe(1);
  });

  it("already-expired token: 3 failures inside 5min mark testStatus expired; modelLocks untouched", async () => {
    const h = makeHarness({
      connections: [oauthConn({
        expiresAt: new Date(NOW - MIN).toISOString(),
        testStatus: "ok",
        modelLock_gpt: { resetAt: new Date(NOW + 6 * 3600_000).toISOString(), reason: "quota" },
        providerSpecificData: { acct: "keep" },
      })],
      refresh: async () => null, // generic transient failure
    });

    await h.tick();
    h.clock.advance(60_000);
    await h.tick();
    h.clock.advance(60_000);
    expect(h.patches).toHaveLength(0); // budget path: next tick retries, no circuit stamp
    await h.tick();

    const mark = h.patches.at(-1);
    expect(mark.patch.testStatus).toBe("expired");
    expect(mark.patch).not.toHaveProperty("refreshToken");
    expect(Object.keys(mark.patch).filter((k) => k.startsWith("modelLock_"))).toEqual([]);
    expect(mark.patch.providerSpecificData.refreshCircuit.attempts).toBe(1);
    expect(Date.parse(mark.patch.providerSpecificData.refreshCircuit.until))
      .toBe(NOW + 2 * 60_000 + BACKOFF_MS[BACKOFF_MS.length - 1]);

    // Row-level guarantee (F27): the exact patch shape above cannot reset locks,
    // because connectionsRepo only wipes modelLock_* for testStatus:"active".
    const normalized = resetHealthStateOnActivation(h.rows[0], {
      testStatus: "expired", lastError: "x", lastErrorAt: "y",
    });
    expect(Object.keys(normalized).filter((k) => k.startsWith("modelLock_"))).toEqual([]);
    expect(normalized.testStatus).toBe("expired");
    expect(h.rows[0].modelLock_gpt).toBeTruthy();

    // The mark opened the 120min circuit: no refresh attempts inside it.
    h.refreshSpy.mockClear();
    h.clock.advance(3 * MIN);
    await h.tick();
    expect(h.refreshSpy).not.toHaveBeenCalled();
  });

  it("expired budget is a sliding 5min window: old failures do not count", async () => {
    const h = makeHarness({
      connections: [oauthConn({ expiresAt: new Date(NOW - MIN).toISOString() })],
      refresh: async () => { throw new Error("upstream 502"); },
    });
    await h.tick();
    h.clock.advance(MIN);
    await h.tick();
    h.clock.advance(6 * MIN); // both failures age out of the window
    const res = await h.tick();
    expect(res.failed).toBe(1);
    expect(h.patches).toHaveLength(0); // still inside budget → no expired mark
  });

  it("a successful refresh clears the circuit and preserves sibling PSD keys", async () => {
    const payload = buildSuccessPersistPayload(
      { copilotToken: "ct", refreshCircuit: { until: "2026-11-02T00:00:00.000Z", attempts: 2 } },
      { accessToken: "at-2", refreshToken: "rt-2", providerSpecificData: { chatgptAccountId: "acc" } }
    );
    expect(payload.providerSpecificData).toEqual({
      copilotToken: "ct",
      chatgptAccountId: "acc",
      refreshCircuit: null,
    });
    expect(payload.existingProviderSpecificData.copilotToken).toBe("ct");
    expect(payload.accessToken).toBe("at-2");
  });
});

describe("token health — shared predicate + T3.1 integration", () => {
  it("canRefreshNow is fail-open on malformed circuit state", () => {
    expect(canRefreshNow(undefined, NOW)).toBe(true);
    expect(canRefreshNow({}, NOW)).toBe(true);
    expect(canRefreshNow({ providerSpecificData: { refreshCircuit: { until: "not-a-date" } } }, NOW)).toBe(true);
    expect(canRefreshNow({ providerSpecificData: { refreshCircuit: { until: NOW + 1 } } }, NOW)).toBe(false);
    expect(canRefreshNow({ providerSpecificData: { refreshCircuit: { until: NOW + 1 } } }, NOW + 1)).toBe(true);
  });

  it("isOAuthRefreshCandidate matches oauth rows with a token only", () => {
    expect(isOAuthRefreshCandidate(oauthConn())).toBe(true);
    expect(isOAuthRefreshCandidate(oauthConn({ authType: "OAuth" }))).toBe(true);
    expect(isOAuthRefreshCandidate(oauthConn({ authType: "access_token" }))).toBe(false);
    expect(isOAuthRefreshCandidate(oauthConn({ authType: "oauth", refreshToken: null }))).toBe(false);
  });

  it("credentialHealth sweep (T3.1) skips connections in refresh-circuit backoff", async () => {
    vi.resetModules();
    const { runCredentialHealthTick } = await import("../../src/lib/credentialHealth/scheduler.js");
    const clock = makeClock();
    const testConnection = vi.fn(async () => ({ valid: true }));
    const inCircuit = oauthConn({
      id: "hc1",
      providerSpecificData: { refreshCircuit: { until: new Date(NOW + 30 * MIN).toISOString(), attempts: 1 } },
    });

    await runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [inCircuit],
      testConnection,
      persistLastTested: async () => {},
    });
    expect(testConnection).not.toHaveBeenCalled(); // circuit window → no probe

    await runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [{ ...inCircuit, providerSpecificData: {} }],
      testConnection,
      persistLastTested: async () => {},
    });
    expect(testConnection).toHaveBeenCalledTimes(1); // circuit open again → probed
  });
});
