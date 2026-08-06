import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRoutingMeta } from "../../open-sse/services/routingMeta.js";

// Drive the REAL account-selection loop in chat.js AND the real auth.js
// (getProviderCredentials + markAccountUnavailable) so we lock the terminal-branch
// reattach that was silently dropping fail-fast metadata:
//   1. keyed provider: single account fails with a skip-rule → excluded → accounts
//      run out → chat.js builds a NEW errorResponse and must reattach { failFast:true }.
//   2. no-auth provider (FREE_PROVIDERS[*].noAuth): getProviderCredentials returns the
//      virtual "noauth" connection (no connectionId) → markAccountUnavailable takes the
//      noauth early-return (shouldFallback:false, NO infinite re-select) → chat.js hits
//      the terminal `return result.response`, which must still carry failFast.
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  handleChatCore: vi.fn(),
}));

// Real auth.js is used (the code under test); only its DB-backed deps are stubbed.
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

function makeRequest(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("chat.js terminal-branch routing metadata (real account loop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComboModels.mockResolvedValue(null);
  });

  it("reattaches failFast onto the terminal errorResponse when keyed accounts run out", async () => {
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      providerSkipRules: [{ provider: "kr-ac", match: { status: 502 }, action: "skip" }],
      maxTransportAttempts: 2,
    });
    mocks.getModelInfo.mockResolvedValue({ provider: "kr-ac", model: "m1" });
    // One keyed connection; once excluded, the next lookup finds nothing available.
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue({
      success: false, status: 502, error: "[502]: connect timeout", errorKind: "http_502",
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const resp = await handleChat(makeRequest("kr-ac/m1"));

    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1); // one account tried, then exhausted
    const meta = getRoutingMeta(resp);
    expect(meta).not.toBeNull();
    expect(meta.failFast).toBe(true); // survived skip → exhaust → freshly-built Response
  });

  it("carries failFast on the no-auth terminal return without looping", async () => {
    // mimo-free is a real FREE_PROVIDERS entry with noAuth:true → virtual connection.
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      providerSkipRules: [{ provider: "mimo-free", match: { status: 502 }, action: "skip" }],
      maxTransportAttempts: 2,
    });
    mocks.getModelInfo.mockResolvedValue({ provider: "mimo-free", model: "mimo-auto" });
    mocks.getProviderConnections.mockResolvedValue([]); // unused on the noAuth path
    mocks.handleChatCore.mockResolvedValue({
      success: false, status: 502, error: "[502]: connect timeout", errorKind: "http_502",
      response: new Response("err", { status: 502 }),
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const resp = await handleChat(makeRequest("mimo-free/mimo-auto"));

    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1); // no infinite re-select of noauth
    expect(getRoutingMeta(resp)?.failFast).toBe(true);
  });
});
