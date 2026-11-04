import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  observeRequest: vi.fn(),
  embeddingsCore: vi.fn(),
  imageCore: vi.fn(),
  getModelInfo: vi.fn(async () => ({ provider: "openai", model: "test-model" })),
}));

vi.mock("@/lib/piiGuard/observe.js", () => ({ observeRequest: mocks.observeRequest, blockMessage: (names, chat = true) => `pii-guard blocked a new value: ${names.join(", ")}.${chat ? " /rewind" : ""}` }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false, piiGuard: { mode: "redact" } }) }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({ connectionId: "connection-a", connectionName: "Provider A" }),
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(), extractApiKey: () => null, isValidApiKey: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: async () => null }));
vi.mock("../../src/sse/services/keyAccess.js", () => ({ getKeyAccessContext: async () => null, enforceKeyAccessResolved: async () => null, enforceKeyAccess: async () => null }));
vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: mocks.embeddingsCore }));
vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: mocks.imageCore }));
vi.mock("../../open-sse/handlers/imageProviders/index.js", () => ({ getImageAdapter: () => null }));
vi.mock("../../open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));
vi.mock("../../open-sse/config/runtimeConfig.js", async (importOriginal) => ({
  ...await importOriginal(),
  HTTP_STATUS: { BAD_REQUEST: 400, BAD_GATEWAY: 502, UNAUTHORIZED: 401, SERVICE_UNAVAILABLE: 503, FORBIDDEN: 403 },
}));
vi.mock("../../src/sse/utils/logger.js", () => ({ request: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), maskKey: vi.fn() }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: async (_provider, credentials) => credentials }));
vi.mock("../../src/sse/services/combo.js", () => ({ handleComboChat: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));

import { handleEmbeddings } from "../../src/sse/handlers/embeddings.js";
import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";

describe("PII guard endpoint hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PII_GUARD_MODULE = "/scanner.js";
    mocks.embeddingsCore.mockResolvedValue({ success: true, response: Response.json({}) });
    mocks.imageCore.mockResolvedValue({ success: true, response: Response.json({}) });
    mocks.observeRequest.mockImplementation(async (body) => {
      if (body.input) body.input = "[REDACTED]";
      if (body.prompt) body.prompt = "[REDACTED]";
    });
  });

  it.each([
    ["embeddings", handleEmbeddings, { model: "openai/test-model", input: "sensitive" }, mocks.embeddingsCore],
    ["image generation", handleImageGeneration, { model: "openai/test-model", prompt: "sensitive" }, mocks.imageCore],
  ])("blocks %s requests before upstream calls", async (_name, handler, body, upstream) => {
    mocks.observeRequest.mockResolvedValue({ blocked: ["Secret"] });
    const response = await handler(new Request("http://localhost/v1/test", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error).toContain("pii-guard blocked a new value: Secret.");
    expect(error).not.toContain("/rewind");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes redacted embeddings input to upstream", async () => {
    await handleEmbeddings(new Request("http://localhost/v1/embeddings", { method: "POST", body: JSON.stringify({ model: "openai/test-model", input: "sensitive" }) }));
    expect(mocks.embeddingsCore).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ input: "[REDACTED]" }) }));
  });

  it("passes redacted image prompt to upstream", async () => {
    await handleImageGeneration(new Request("http://localhost/v1/images/generations", { method: "POST", body: JSON.stringify({ model: "openai/test-model", prompt: "sensitive" }) }));
    expect(mocks.imageCore).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ prompt: "[REDACTED]" }) }));
  });
});
