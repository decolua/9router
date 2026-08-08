import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

function makeRequest(model = "combo-ag") {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

function capacityError(model = "claude-opus-4-6-thinking") {
  return JSON.stringify({
    error: {
      code: 503,
      message: `No capacity available for model ${model} on the server`,
      status: "UNAVAILABLE",
      details: [{
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "MODEL_CAPACITY_EXHAUSTED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: { model },
      }],
    },
  });
}

describe("Antigravity combo capacity cycling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStickyRoundRobinLimit: 1,
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
    });
    mocks.getComboModels.mockImplementation(async (model) => (
      model === "combo-ag"
        ? ["ag/claude-opus-4-6-thinking", "anthropic/claude-sonnet-4.5"]
        : null
    ));
    mocks.getModelInfo.mockImplementation(async (modelStr) => {
      if (modelStr === "ag/claude-opus-4-6-thinking") {
        return { provider: "antigravity", model: "claude-opus-4-6-thinking" };
      }
      if (modelStr === "anthropic/claude-sonnet-4.5") {
        return { provider: "anthropic", model: "claude-sonnet-4.5" };
      }
      return { provider: null, model: modelStr };
    });
    // Pool resweep gates on the rule's opt-in resweep signal (sweep:true), not a
    // hardcoded capacity check — so markAccountUnavailable must report resweep:true.
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0, failFast: true, resweep: true });
  });

  it("restarts the Antigravity account sweep after all accounts report model capacity before trying the next combo model", async () => {
    const { handleChat } = await import("../../src/sse/handlers/chat.js");

    const excludeSnapshots = [];
    let antigravityEmptySweepCount = 0;
    mocks.getProviderCredentials.mockImplementation(async (provider, excludeConnectionIds) => {
      const excluded = [...(excludeConnectionIds || [])];
      excludeSnapshots.push({ provider, excluded });

      if (provider === "anthropic") {
        return { connectionId: "anthropic-1", connectionName: "Anthropic 1" };
      }

      if (excluded.length === 0) {
        antigravityEmptySweepCount += 1;
        return { connectionId: "ag-1", connectionName: `AG 1 sweep ${antigravityEmptySweepCount}` };
      }

      if (excluded.length === 1 && excluded[0] === "ag-1") {
        return { connectionId: "ag-2", connectionName: "AG 2" };
      }

      return null;
    });

    mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => {
      if (modelInfo.provider === "anthropic") {
        return { success: true, response: new Response("anthropic-ok", { status: 200 }) };
      }
      if (antigravityEmptySweepCount >= 2) {
        return { success: true, response: new Response("ag-ok", { status: 200 }) };
      }
      return { success: false, status: 503, error: capacityError() };
    });

    const response = await handleChat(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ag-ok");
    expect(excludeSnapshots).toEqual([
      { provider: "antigravity", excluded: [] },
      { provider: "antigravity", excluded: ["ag-1"] },
      { provider: "antigravity", excluded: ["ag-1", "ag-2"] },
      { provider: "antigravity", excluded: [] },
    ]);
    expect(mocks.handleChatCore).not.toHaveBeenCalledWith(
      expect.objectContaining({
        modelInfo: expect.objectContaining({ provider: "anthropic" }),
      }),
    );
  });

  it("does NOT resweep the pool when resweep:false → each account tried once, combo moves to next model", async () => {
    // Negative control for the chat.js gate (the exact site of the prior regression):
    // a plain skip (resweep:false) must try each Antigravity account exactly once and
    // then let combo advance to the next model — NOT restart the account sweep.
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 0, failFast: true, resweep: false });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const excludeSnapshots = [];
    mocks.getProviderCredentials.mockImplementation(async (provider, excludeConnectionIds) => {
      const excluded = [...(excludeConnectionIds || [])];
      excludeSnapshots.push({ provider, excluded });
      if (provider === "anthropic") return { connectionId: "anthropic-1", connectionName: "Anthropic 1" };
      if (excluded.length === 0) return { connectionId: "ag-1", connectionName: "AG 1" };
      if (excluded.length === 1 && excluded[0] === "ag-1") return { connectionId: "ag-2", connectionName: "AG 2" };
      return null; // pool exhausted, no resweep
    });
    mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => {
      if (modelInfo.provider === "anthropic") {
        return { success: true, response: new Response("anthropic-ok", { status: 200 }) };
      }
      return { success: false, status: 503, error: capacityError() };
    });

    const response = await handleChat(makeRequest());

    // Antigravity: each of the two accounts tried exactly once (no resweep loop).
    const agCalls = mocks.handleChatCore.mock.calls.filter(
      ([arg]) => arg?.modelInfo?.provider === "antigravity"
    );
    expect(agCalls).toHaveLength(2);
    // Anthropic: tried once and succeeded → combo actually advanced to the next model.
    const anthropicCalls = mocks.handleChatCore.mock.calls.filter(
      ([arg]) => arg?.modelInfo?.provider === "anthropic"
    );
    expect(anthropicCalls).toHaveLength(1);
    // Antigravity account selection never restarts (no second excluded:[] for antigravity).
    const agEmptySweeps = excludeSnapshots.filter(s => s.provider === "antigravity" && s.excluded.length === 0);
    expect(agEmptySweeps).toHaveLength(1);
    // Final response is Anthropic's success.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("anthropic-ok");
  });
});
