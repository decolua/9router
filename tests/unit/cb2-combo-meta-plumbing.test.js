/**
 * CB2 — the plumbing half of D13 (ii): the combo name must survive
 *   handleChat → handleComboChat → handleSingleModelChat → handleChatCore,
 * and the account identity must survive
 *   handleSingleModelChat → (attemptUsage scratch) → the combo loop's failure line.
 *
 * Only `handleChatCore` and the persistence shim are stubbed. The real chat.js
 * account loop and the real combo loop run, so a dropped argument, a scratch
 * stamped in the wrong place, or a combo attributed where none exists fails
 * here — no other suite looks at this seam.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(async () => {}),
  clearAntigravityStrikes: vi.fn(),
  extractApiKey: vi.fn(() => "client-key"),
  isValidApiKey: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: mocks.appendRequestLog,
  saveRequestDetail: mocks.saveRequestDetail,
  getUsageHistory: vi.fn(async () => []),
  getUsageStats: vi.fn(async () => ({})),
  getChartData: vi.fn(async () => []),
  getRecentLogs: vi.fn(async () => []),
  getActiveRequests: vi.fn(async () => ({ activeRequests: [], recentRequests: [], errorProvider: "" })),
  trackPendingRequest: vi.fn(),
  statsEmitter: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn(), setMaxListeners: vi.fn() },
  drainPendingUsage: vi.fn(async () => ({ drained: 0 })),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  clearAntigravityStrikes: mocks.clearAntigravityStrikes,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("@/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: vi.fn(async () => null),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getComboByName: mocks.getComboByName,
  getCombos: mocks.getCombos,
  getProviderConnectionById: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: mocks.getProviderNodes,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn((x) => x), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  maskKey: vi.fn(() => "masked"), line: vi.fn(), errorLine: vi.fn(),
  tagForSession: vi.fn(() => "[t]"), nextTag: vi.fn(() => "[t]"),
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn(async () => null), getPxpipeTransform: vi.fn(async () => null) }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

import { handleChat } from "@/sse/handlers/chat.js";
import { resetComboRotation } from "../../open-sse/services/combo.js";
import { resetAllCircuitBreakers } from "../../open-sse/utils/circuitBreaker.js";

const COMBO = "cb2-plumbing";

// Combo table for this file. Lookups are keyed by string and never include a
// combo as one of its own members, so the nested branch below is exactly one
// level deep (an unbounded mock here makes chat.js recurse until the heap dies).
const COMBOS = {
  [COMBO]: ["grok/grok-3", "glm/glm-4"],
  "outer-combo": ["inner-combo", "glm/glm-4"],
  "inner-combo": ["grok/grok-3"],
};

const chatRequest = (model) => new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
});

const jsonOk = () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }), {
  status: 200, headers: { "Content-Type": "application/json" },
});

const failCore = (status, error = "boom") => ({
  success: false, status, error, response: new Response(error, { status }),
});

beforeEach(() => {
  vi.clearAllMocks();
  resetComboRotation();
  resetAllCircuitBreakers();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.getComboModels.mockImplementation(async (m) => COMBOS[m] || null);
  mocks.getModelInfo.mockImplementation(async (m) => {
    if (COMBOS[m]) return { provider: null, model: null };
    const [provider, ...rest] = m.split("/");
    return { provider, model: rest.join("/") };
  });
  // Real semantics: an excluded connection must NOT be handed back, otherwise
  // chat.js's account loop would re-pick it forever.
  mocks.getProviderCredentials.mockImplementation(async (provider, exclude) => {
    const id = `conn-${provider}`;
    if (exclude instanceof Set && exclude.has(id)) return null;
    return {
      apiKey: "k", accessToken: "t", connectionId: id,
      connectionName: `acc-${id}`, providerSpecificData: { maxConcurrency: 4 },
    };
  });
  mocks.checkAndRefreshToken.mockImplementation(async (_p, c) => c);
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
});

describe("combo identity reaches chatCore (winner-line attribution)", () => {
  it("every combo member dispatch carries comboName, and the failed member writes its own line", async () => {
    mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => (
      modelInfo.provider === "grok" ? failCore(503, "upstream 503") : { success: true, response: jsonOk() }
    ));

    const res = await handleChat(chatRequest(COMBO));
    expect(res.status).toBe(200);

    const calls = mocks.handleChatCore.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.modelInfo.provider), "both members were dispatched").toEqual(["grok", "glm"]);
    expect(calls.every((c) => c.comboName === COMBO)).toBe(true);

    const payloads = mocks.saveRequestUsage.mock.calls.map((c) => c[0]);
    expect(payloads.length, "the failed member wrote its own line").toBe(1);
    expect(payloads[0].status).toBe("error:503");
    expect(payloads[0].meta).toEqual({ combo: COMBO, member: "grok/grok-3", attempt: 1, endpoint: "/v1/chat/completions" });
    expect(payloads[0].connectionId, "the account that actually got the call").toBe("conn-grok");
    expect(payloads[0].apiKey).toBe("client-key");
    expect(payloads[0].provider).toBe("grok");
    expect(payloads[0].model).toBe("grok-3");
    expect(payloads[0].usageEventId, "its own id, never the winner's").toBeTruthy();
    // canonicalizeUsage() normalises the shape (total/cached keys) — the point
    // is that a failure row carries no billable tokens at all.
    expect(payloads[0].tokens.prompt_tokens).toBe(0);
    expect(payloads[0].tokens.completion_tokens).toBe(0);
  });

  it("a plain single-model request carries NO comboName and writes no failure line", async () => {
    mocks.handleChatCore.mockResolvedValue(failCore(500));

    const res = await handleChat(chatRequest("glm/glm-4"));
    expect(res.status).toBe(500);
    expect(mocks.handleChatCore.mock.calls[0][0].comboName ?? null).toBe(null);
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("the CAPACITY-ADAPTER loop is not attributed to a combo", async () => {
    // A vision request against a non-vision model runs the SAME loop with
    // comboName = the requested model. That is not a user combo: attributing it
    // would invent one for the dashboard.
    mocks.handleChatCore.mockResolvedValue(failCore(500));

    await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm/glm-4",
        messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "https://x/y.png" } }] }],
      }),
    }));

    const calls = mocks.handleChatCore.mock.calls.map((c) => c[0]);
    expect(calls.length, "the adapter still dispatches").toBeGreaterThan(0);
    for (const c of calls) expect(c.comboName ?? null).toBe(null);
    expect(mocks.saveRequestUsage, "no combo-attributed failure rows").not.toHaveBeenCalled();
  });

  it("an all-members-down combo reports each attempt exactly once", async () => {
    mocks.handleChatCore.mockResolvedValue(failCore(429, "rate limited"));

    const res = await handleChat(chatRequest(COMBO));
    expect(res.status).toBe(429);

    const payloads = mocks.saveRequestUsage.mock.calls.map((c) => c[0]);
    expect(payloads.map((p) => p.meta.member)).toEqual(["grok/grok-3", "glm/glm-4"]);
    expect(payloads.map((p) => p.meta.attempt)).toEqual([1, 2]);
    expect(payloads.every((p) => p.status === "error:429")).toBe(true);
    expect(new Set(payloads.map((p) => p.usageEventId)).size).toBe(2);
  });

  it("an account never dispatched (no credentials at all) is not a failed attempt", async () => {
    mocks.getProviderCredentials.mockResolvedValue(null);
    mocks.handleChatCore.mockResolvedValue({ success: true, response: jsonOk() });

    await handleChat(chatRequest("grok/grok-3"));

    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.saveRequestUsage, "a pre-upstream skip writes no usage line").not.toHaveBeenCalled();
  });

  it("a NESTED combo attributes its own inner loop, one level deep", async () => {
    // Real shape of chat.js's nested branch: an outer combo whose first member
    // is itself a combo name (getModelInfo → provider null).
    mocks.handleChatCore.mockResolvedValue({ success: true, response: jsonOk() });

    const res = await handleChat(chatRequest("outer-combo"));
    expect(res.status).toBe(200);

    const calls = mocks.handleChatCore.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => `${c.modelInfo.provider}/${c.modelInfo.model}`)).toEqual(["grok/grok-3"]);
    // The inner loop owns its member; the outer member that only forwarded to it
    // is deliberately not double-attributed (documented limitation of D13/CB2).
    expect(calls[0].comboName).toBe("inner-combo");
    expect(mocks.saveRequestUsage, "success writes no combo failure row").not.toHaveBeenCalled();
  });

  it("a SELF-REFERENCING combo cannot spin the process into a heap OOM", async () => {
    // Pre-existing hazard found by CB2: nothing forbids saving a combo whose
    // member list names a combo again, including itself. Without the chain guard
    // in handleSingleModelChat this call recurses until the worker dies — which
    // is exactly what an earlier revision of this very file did by accident.
    const CYCLE = {
      "loop-combo": ["loop-combo", "glm/glm-4"],
      "a-combo": ["b-combo"],
      "b-combo": ["a-combo", "grok/grok-3"],
    };
    mocks.getComboModels.mockImplementation(async (m) => CYCLE[m] || null);
    mocks.getModelInfo.mockImplementation(async (m) => {
      if (CYCLE[m]) return { provider: null, model: null };
      const [provider, ...rest] = m.split("/");
      return { provider, model: rest.join("/") };
    });
    mocks.handleChatCore.mockResolvedValue({ success: true, response: jsonOk() });

    const self = await handleChat(chatRequest("loop-combo"));
    expect([200, 400, 503], "answers instead of hanging").toContain(self.status);
    const dispatches = mocks.handleChatCore.mock.calls.length;
    expect(dispatches, "the cycle is expanded at most once per name").toBeLessThanOrEqual(2);

    mocks.handleChatCore.mockClear();
    const mutual = await handleChat(chatRequest("a-combo"));
    expect([200, 400, 503]).toContain(mutual.status);
    expect(mocks.handleChatCore.mock.calls.length, "A→B→A stops at the repeat").toBeLessThanOrEqual(2);
  });

  it("a member whose account failed and fell to a second account reports the account that ran last", async () => {
    const seen = [];
    mocks.getProviderCredentials.mockImplementation(async (provider, exclude) => {
      const taken = exclude instanceof Set ? [...exclude] : [];
      const idx = taken.length;
      const id = idx === 0 ? `conn-${provider}-a` : idx === 1 ? `conn-${provider}-b` : null;
      if (!id) return null;
      return { apiKey: "k", accessToken: "t", connectionId: id, connectionName: id, providerSpecificData: {} };
    });
    mocks.handleChatCore.mockImplementation(async ({ connectionId }) => {
      seen.push(connectionId);
      return failCore(500);
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });

    const res = await handleChat(chatRequest(COMBO));
    expect(seen.length, "both accounts of each member were tried").toBe(4);

    const payloads = mocks.saveRequestUsage.mock.calls.map((c) => c[0]);
    expect(payloads.length, "one line per MEMBER, not per account").toBe(2);
    expect(payloads.map((p) => p.meta.member)).toEqual(["grok/grok-3", "glm/glm-4"]);
    // The identity on the row is the account that ran LAST for that member; the
    // status is what the member finally answered with (chat.js's own
    // "all accounts unavailable" 503, not the first account's 500).
    expect(payloads.map((p) => p.connectionId)).toEqual(["conn-grok-b", "conn-glm-b"]);
    expect(payloads.map((p) => p.status)).toEqual(["error:503", "error:503"]);
    expect(res.status).toBe(503);
  });
});
