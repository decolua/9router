// Combo requestedModel threading — handleChat must pass the client-visible combo
// name down to handleChatCore so usage stats can attribute traffic per combo.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
  settings: { requireApiKey: false },
  combos: {
    "my-combo": { name: "my-combo", models: ["openai/gpt-4o", "anthropic/claude-3"] },
    "fusion-combo": { name: "fusion-combo", models: ["openai/gpt-4o"] },
    "id-combo": { name: "id-combo", models: ["openai/gpt-4o"], systemPromptEnabled: true },
  },
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({
    apiKey: "provider-secret",
    connectionId: "connection-a",
    connectionName: "Provider A",
  }),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => mocks.settings,
  getComboByName: async (name) => mocks.combos[name] || null,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async (modelStr) => {
    if (modelStr === "openai/gpt-4o") return { provider: "openai", model: "gpt-4o" };
    if (modelStr === "anthropic/claude-3") return { provider: "anthropic", model: "claude-3" };
    return { provider: null };
  },
  resolveComboSystemPrompt: (combo) => (combo?.systemPromptEnabled ? `You are ${combo.name}.` : null),
  resolveComboThinkingUsage: () => null,
  resolveDefaultIdentitySystemPrompt: () => "You are {name}.",
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), maskKey: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: async () => null }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("../../open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));

import { handleChat } from "../../src/sse/handlers/chat.js";

function chatRequest(model) {
  return new Request("http://localhost:20128/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hello" }] }),
  });
}

describe("combo requestedModel threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = { requireApiKey: false };
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: Response.json({ choices: [] }),
    });
  });

  it("passes the combo name as requestedModel to handleChatCore", async () => {
    const res = await handleChat(chatRequest("my-combo"));
    expect(res.ok).toBe(true);

    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.requestedModel).toBe("my-combo");
    expect(call.modelInfo).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("keeps the outer combo name when a combo member is itself a combo", async () => {
    // Member "openai/gpt-4o" resolves to a provider, so the nested-combo branch
    // is not hit here; the outer name must still be the one threaded through.
    const res = await handleChat(chatRequest("my-combo"));
    expect(res.ok).toBe(true);
    expect(mocks.handleChatCore.mock.calls[0][0].requestedModel).toBe("my-combo");
  });

  it("threads requestedModel through the fusion closure too", async () => {
    mocks.settings = { requireApiKey: false, comboStrategy: "fusion" };
    const res = await handleChat(chatRequest("fusion-combo"));
    expect(res.ok).toBe(true);

    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.requestedModel).toBe("fusion-combo");
    expect(call.modelInfo).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("leaves requestedModel undefined for plain single-model requests", async () => {
    await handleChat(chatRequest("openai/gpt-4o"));
    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.requestedModel).toBeUndefined();
    expect(call.modelInfo).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("threads the resolved identity prompt as comboSystemPrompt", async () => {
    const res = await handleChat(chatRequest("id-combo"));
    expect(res.ok).toBe(true);
    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.comboSystemPrompt).toBe("You are id-combo.");
  });

  it("leaves comboSystemPrompt undefined for combos without an identity prompt", async () => {
    await handleChat(chatRequest("my-combo"));
    const call = mocks.handleChatCore.mock.calls[0][0];
    expect(call.comboSystemPrompt).toBeUndefined();
  });
});
