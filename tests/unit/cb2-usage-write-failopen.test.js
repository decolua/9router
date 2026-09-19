/**
 * CB2 — writing a combo failure line must NEVER be observable by the client.
 *
 * This file is the counterpart of cb2-combo-failure-events.test.js: there the
 * storage layer is real and the assertions are about WHAT is persisted; here
 * the writer itself is the seam under stub, because the only thing being proven
 * is that a broken recorder cannot change the response or stop the fallback
 * chain (the F12 fire-and-forget contract, D13 "escrita best-effort").
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "client-key"),
  isValidApiKey: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(async () => null),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  getUsageHistory: vi.fn(async () => []),
  getUsageStats: vi.fn(async () => ({})),
  getChartData: vi.fn(async () => []),
  getRecentLogs: vi.fn(async () => []),
  getActiveRequests: vi.fn(async () => ({ activeRequests: [], recentRequests: [], errorProvider: "" })),
  trackPendingRequest: vi.fn(),
  statsEmitter: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn(), setMaxListeners: vi.fn() },
  drainPendingUsage: vi.fn(async () => ({ drained: 0 })),
}));

import { handleComboChat } from "../../open-sse/services/combo.js";
import {
  saveComboAttemptFailure,
  saveUsageStats,
  failureStatusOf,
  attachUsageEventMeta as saveUsageEventMetaForTest,
  usageEventMetaDepth,
  USAGE_EVENT_META_MAX,
} from "../../open-sse/handlers/chatCore/requestDetail.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const err = (status, message) => new Response(JSON.stringify({ error: { message } }), { status });
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });

/** chat.js owns + stamps the attempt scratch; mirrored so the loop sees a real dispatch. */
function attemptStub() {
  const attemptUsage = { apiKey: "client-key", endpoint: "/v1/chat/completions" };
  const wrap = (fn) => async (b, m) => {
    attemptUsage.reachedUpstream = true;
    attemptUsage.connectionId = "conn-1";
    return fn(b, m);
  };
  return { attemptUsage, wrap };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
});

describe("combo failure recorder is fail-open", () => {
  it("a writer that THROWS synchronously does not change the response nor stop the fallback", async () => {
    mocks.saveRequestUsage.mockImplementation(() => { throw new Error("db on fire"); });
    const { attemptUsage, wrap } = attemptStub();

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "boom",
      attemptUsage,
      log,
      handleSingleModel: wrap(async (_b, m) => (m === "grok/grok-3" ? err(429, "rate limited") : ok())),
    });

    expect(response.status, "the winning member still answers").toBe(200);
    expect(mocks.saveRequestUsage, "the failure attempt was still attempted").toHaveBeenCalled();
  });

  it("a writer that REJECTS does not change the response", async () => {
    mocks.saveRequestUsage.mockRejectedValue(new Error("offline"));
    const { attemptUsage, wrap } = attemptStub();

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "boom",
      attemptUsage,
      log,
      handleSingleModel: wrap(async (_b, m) => (m === "grok/grok-3" ? err(502, "bad gateway") : ok())),
    });

    expect(response.status).toBe(200);
    await Promise.resolve();
    expect(mocks.saveRequestUsage).toHaveBeenCalled();
  });

  it("saveComboAttemptFailure swallows a writer that throws", () => {
    mocks.saveRequestUsage.mockImplementation(() => { throw new Error("nope"); });
    expect(() => saveComboAttemptFailure({
      comboName: "c", member: "grok/grok-3", provider: "grok", model: "grok-3", attempt: 1, status: 500,
    })).not.toThrow();
  });

  it("an all-members-failed combo still returns its error trail with failures recorded", async () => {
    mocks.saveRequestUsage.mockResolvedValue(undefined);
    const { attemptUsage, wrap } = attemptStub();

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["grok/grok-3", "glm/glm-4"],
      comboName: "allbad",
      attemptUsage,
      log,
      handleSingleModel: wrap(async (_b, m) => err(m === "grok/grok-3" ? 500 : 504, "down")),
    });

    expect(response.status).toBe(504);
    const payloads = mocks.saveRequestUsage.mock.calls.map((c) => c[0]);
    expect(payloads.length).toBe(2);
    expect(payloads.map((p) => p.status)).toEqual(["error:500", "error:504"]);
    expect(payloads.map((p) => p.meta.combo)).toEqual(["allbad", "allbad"]);
    expect(payloads.map((p) => p.meta.attempt)).toEqual([1, 2]);
    expect(new Set(payloads.map((p) => p.usageEventId)).size, "distinct event ids").toBe(2);
  });
});

describe("status/meta formatting contract", () => {
  it("failureStatusOf maps http, carried codes and throw kinds", () => {
    expect(failureStatusOf(429)).toBe("error:429");
    expect(failureStatusOf(503, null)).toBe("error:503");
    expect(failureStatusOf(null, { statusCode: 502 })).toBe("error:502");
    expect(failureStatusOf(null, new Error("This operation was aborted"))).toBe("error:timeout");
    expect(failureStatusOf(null, new Error("read ECONNRESET"))).toBe("error:threw");
    expect(failureStatusOf(null, null)).toBe("error:threw");
    expect(failureStatusOf("", undefined)).toBe("error:threw");
  });

  it("the normal (success) path keeps its no-tokens gate — only failure events may write zeros", async () => {
    saveUsageStats({ provider: "grok", model: "grok-3", tokens: { prompt_tokens: 0, completion_tokens: 0 } });
    saveUsageStats({ provider: "grok", model: "grok-3", tokens: null });
    saveUsageStats({ provider: "grok", model: "grok-3" });
    expect(mocks.saveRequestUsage, "three no-token writes, zero rows").not.toHaveBeenCalled();

    saveUsageStats({
      provider: "grok", model: "grok-3",
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
      metaExtra: { combo: "c" }, statusOverride: "error:500",
    });
    expect(mocks.saveRequestUsage, "an explicit failure event does write").toHaveBeenCalledTimes(1);
    const entry = mocks.saveRequestUsage.mock.calls[0][0];
    expect(entry.status).toBe("error:500");
    expect(entry.meta).toEqual({ combo: "c" });
  });

  it("the combo-attribution registry is BOUNDED: 6000 attached ids evict the oldest, never the newest", async () => {
    // chatCore attaches one entry per combo attempt; a stream that dies before
    // any write (or a 0-token response) never consumes it. Without the cap the
    // map would grow with traffic forever.
    // N > EVENT_META_MAX (5000) in requestDetail.js.
    const N = 6000;
    for (let i = 0; i < N; i++) {
      saveUsageEventMetaForTest(`evt-${i}`, { combo: "c", member: `p/m-${i}` });
    }
    mocks.saveRequestUsage.mockClear();

    // oldest evicted → writing that event yields NO meta
    saveUsageStats({ provider: "p", model: "m-0", tokens: { prompt_tokens: 1, completion_tokens: 1 }, usageEventId: "evt-0" });
    expect(mocks.saveRequestUsage.mock.calls[0][0].meta, "evicted entry yields no meta").toBeUndefined();

    // newest survives → writing that event carries its meta
    saveUsageStats({ provider: "p", model: "m-x", tokens: { prompt_tokens: 1, completion_tokens: 1 }, usageEventId: `evt-${N - 1}` });
    expect(mocks.saveRequestUsage.mock.calls[1][0].meta).toEqual({ combo: "c", member: `p/m-${N - 1}` });

    // consuming an entry frees its slot: the same id attached twice resolves once
    saveUsageStats({ provider: "p", model: "m-x", tokens: { prompt_tokens: 1, completion_tokens: 1 }, usageEventId: `evt-${N - 1}` });
    expect(mocks.saveRequestUsage.mock.calls[2][0].meta, "consumed, not reused").toBeUndefined();
  });

  it("the registry SIZE is capped, not just the eviction order", () => {
    expect(usageEventMetaDepth(), "starts drained from the previous case").toBeLessThanOrEqual(USAGE_EVENT_META_MAX);
    for (let i = 0; i < USAGE_EVENT_META_MAX + 2000; i++) {
      saveUsageEventMetaForTest(`bulk-${i}`, { combo: "c", member: `p/m-${i}` });
      expect(usageEventMetaDepth(), `entry ${i} never lets the map exceed the cap`).toBeLessThanOrEqual(USAGE_EVENT_META_MAX);
    }
    // clean up so no other case in this file inherits a full registry
    for (let i = 0; i < USAGE_EVENT_META_MAX + 2000; i++) {
      saveUsageStats({ provider: "p", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 }, usageEventId: `bulk-${i}` });
    }
    mocks.saveRequestUsage.mockClear();
  });

  it("attach ignores junk input instead of throwing on the request path", () => {
    expect(() => saveUsageEventMetaForTest(null, { combo: "c" })).not.toThrow();
    expect(() => saveUsageEventMetaForTest("evt-junk", null)).not.toThrow();
    expect(() => saveUsageEventMetaForTest(42, { combo: "c" })).not.toThrow();
    saveUsageStats({ provider: "p", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 }, usageEventId: "evt-junk" });
    expect(mocks.saveRequestUsage.mock.calls.at(-1)[0].meta).toBeUndefined();
  });

  it("a success row without any combo attribution persists NO meta key at all (byte-identical to before)", async () => {
    saveUsageStats({ provider: "grok", model: "grok-3", tokens: { prompt_tokens: 5, completion_tokens: 2 }, usageEventId: "evt-plain" });
    const entry = mocks.saveRequestUsage.mock.calls[0][0];
    expect("meta" in entry).toBe(false);
    expect("status" in entry).toBe(false);
    expect(entry.usageEventId).toBe("evt-plain");
  });
});
