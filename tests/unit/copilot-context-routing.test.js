import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => executor }));
vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: () => null, isValidApiKey: async () => true,
  getProviderCredentials: async (provider) => provider === "missing" ? null : ({ connectionId: "test-connection", providerSpecificData: {} }),
  markAccountUnavailable: async () => ({ shouldFallback: false }), clearAccountError: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_provider, credentials) => credentials, updateProviderCredentials: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: async (model) => model === "combo" ? ["github/gpt-4o", "missing/gpt-4o"] : null,
  getModelInfo: async (id) => { const [provider, model] = id.split("/"); return { provider, model }; },
}));
vi.mock("../../src/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: async () => null, enforceKeyAccess: async () => null,
  filterAdapterModels: async (_context, models) => models,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback", capacityAdapter: {} }) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {}, logProviderResponse() {},
    logConvertedResponse() {}, logError() {},
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import { GithubExecutor } from "../../open-sse/executors/github.js";
import { handleChat } from "../../src/sse/handlers/chat.js";

const executor = new GithubExecutor();
executor.noAuth = true;
executor.execute = vi.fn();
const message = "Your input exceeds the context window of this model. Please adjust your input and try again.";

beforeEach(() => {
  vi.clearAllMocks();
  executor.execute.mockImplementation(async () => ({
    response: new Response(JSON.stringify({ error: { code: "invalid_request_body", message } }), { status: 400 }),
    url: "https://api.githubcopilot.com/responses", headers: {}, transformedBody: {},
  }));
});

function request(model, stream = true) {
  return handleChat(new Request("http://localhost/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream, input: "hi" }),
  }));
}

describe("final Responses context-error delivery", () => {
  it.each(["github/gpt-4o", "combo"])("returns response.failed after routing %s has exhausted its candidates", async (model) => {
    const response = await request(model);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const event = JSON.parse(text.split("\n").find((line) => line.startsWith("data: {")).slice(6));
    expect(event.type).toBe("response.failed");
    expect(event.response).toMatchObject({ status: "failed", error: { code: "context_length_exceeded", message: expect.stringContaining(message) } });
    expect(text).not.toContain("No active credentials");
  });

  it("keeps the original context HTTP error for a non-streaming combo request", async () => {
    const response = await request("combo", false);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("context_length_exceeded");
  });

  it("does not convert an unrelated bad request to a success HTTP response", async () => {
    executor.execute.mockResolvedValue({ response: new Response('{"error":{"code":"invalid_request_body","message":"Missing input"}}', { status: 400 }), headers: {}, transformedBody: {} });
    const response = await request("github/gpt-4o");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request_body");
  });
});
