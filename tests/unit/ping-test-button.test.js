import { describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/shared/constants/config", () => ({
  UPDATER_CONFIG: { appPort: 20128 },
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: (provider, model) => {
    // mirror the real pattern matching for the two cases under test
    const m = String(model || "");
    return { reasoning: /gpt-5|o1|o3|o4/.test(m) || /gpt-5|o1|o3|o4/.test(String(provider || "")) };
  },
}), { virtual: true });

vi.stubGlobal("fetch", mocks.fetch);

const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

function jsonResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      ...overrides,
    }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("pingModelByKind chat probe", () => {
  it("sends a 16-token probe for plain models", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse());
    await pingModelByKind("openai/gpt-4o", "llm", "http://127.0.0.1:1");
    const [, init] = mocks.fetch.mock.calls[0];
    expect(JSON.parse(init.body).max_tokens).toBe(16);
  });

  it("sends a 1024-token probe for reasoning models so chain-of-thought is not starved", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse());
    await pingModelByKind("openai/gpt-5.2", "llm", "http://127.0.0.1:1");
    const [, init] = mocks.fetch.mock.calls[0];
    expect(JSON.parse(init.body).max_tokens).toBe(1024);
  });

  it("still reports ok when a reasoning model emits content", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse());
    const result = await pingModelByKind("openai/gpt-5.2", "llm", "http://127.0.0.1:1");
    expect(result.ok).toBe(true);
  });
});
