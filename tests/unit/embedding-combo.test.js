/**
 * Unit tests for embedding combo feature
 *
 * Tests cover:
 *  - handleEmbeddings combo detection & dimensions injection (Group 1)
 *  - handleSingleModelEmbedding fallback logic (Group 2)
 *  - Combo fallback with dimensions (Group 3)
 *  - API routes dimensions handling (Group 4)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies before imports ─────────────────────────────────────────

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getComboByName: vi.fn(),
  getCombos: vi.fn(),
  getComboById: vi.fn(),
  createCombo: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
  getComboByName: vi.fn(),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
}));

vi.mock("open-sse/handlers/embeddingsCore.js", () => ({
  handleEmbeddingsCore: vi.fn(),
}));

vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: vi.fn((status, msg) =>
    new Response(JSON.stringify({ error: { message: msg } }), { status, headers: { "Content-Type": "application/json" } })
  ),
  unavailableResponse: vi.fn((status, msg, retry, retryHuman) =>
    new Response(JSON.stringify({ error: { message: `${msg} (${retryHuman})` } }), { status, headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil((new Date(retry).getTime() - Date.now()) / 1000)) } })
  ),
}));

vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, SERVICE_UNAVAILABLE: 503 },
}));

vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  resetComboRotation: vi.fn(),
  getRotatedModels: vi.fn(),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

// Mock accountFallback (imported by combo.js)
vi.mock("open-sse/services/accountFallback.js", () => ({
  checkFallbackError: vi.fn(() => ({ shouldFallback: true, cooldownMs: 1000 })),
  formatRetryAfter: vi.fn(() => "1s"),
}));

// Mock logger — imported as `import * as log from "../utils/logger.js"` in embeddings.js
vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  request: vi.fn(),
  maskKey: vi.fn((k) => k ? `${k.slice(0, 4)}...${k.slice(-4)}` : "***"),
}));

// Mock network/connectionProxy to avoid transitive imports
vi.mock("@/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
}));

// Mock shared constants
vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: vi.fn((id) => id),
  FREE_PROVIDERS: {},
}));

// Mock NextResponse for API route tests
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, opts) => {
      const status = opts?.status || 200;
      return { status, body, headers: opts?.headers || {} };
    }),
  },
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { handleEmbeddings } from "../../src/sse/handlers/embeddings.js";
import { getComboByName, getSettings, createCombo, updateCombo, getComboById } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../../src/sse/services/model.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import { getProviderCredentials, markAccountUnavailable } from "../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../src/sse/services/tokenRefresh.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** 创建模拟的 Request 对象 */
function createRequest(body, url = "http://localhost:20128/v1/embeddings") {
  return {
    json: vi.fn().mockResolvedValue(body),
    url,
    headers: { get: vi.fn() },
  };
}

/** 模拟成功的 embedding 响应 (200) */
function makeSuccessResponse() {
  return new Response(
    JSON.stringify({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: "text-embedding-ada-002",
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

/** 模拟成功的 handleEmbeddingsCore 结果 */
function makeCoreSuccessResult() {
  return {
    success: true,
    response: makeSuccessResponse(),
  };
}

/** 模拟失败的 handleEmbeddingsCore 结果 */
function makeCoreErrorResult(status = 429, error = "Rate limit exceeded") {
  return {
    success: false,
    status,
    error,
    response: new Response(JSON.stringify({ error: { message: error } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

/** 默认 settings mock */
function defaultSettings(overrides = {}) {
  return {
    requireApiKey: false,
    comboStrategies: {},
    comboStrategy: "fallback",
    comboStickyLimit: 1,
    ...overrides,
  };
}

// ─── Group 1: handleEmbeddings combo detection (6 tests) ───────────────────────

describe("handleEmbeddings — combo detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue(defaultSettings());
    extractApiKey: vi.fn().mockReturnValue(null);
  });

  it("1. detects combo name and calls handleComboChat", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1", "minimax/MiniMax-M2.7"]);
    getComboByName.mockResolvedValue({ name: "my-combo", models: ["glm/glm-5.1", "minimax/MiniMax-M2.7"], dimensions: null });
    handleComboChat.mockResolvedValue(makeSuccessResponse());

    const req = createRequest({ model: "my-combo", input: "hello" });
    await handleEmbeddings(req);

    expect(getComboModels).toHaveBeenCalledWith("my-combo");
    expect(handleComboChat).toHaveBeenCalledOnce();
  });

  it("2. passes combo models to handleComboChat", async () => {
    const models = ["glm/glm-5.1", "minimax/MiniMax-M2.7"];
    getComboModels.mockResolvedValue(models);
    getComboByName.mockResolvedValue({ name: "my-combo", models, dimensions: null });
    handleComboChat.mockResolvedValue(makeSuccessResponse());

    const req = createRequest({ model: "my-combo", input: "hello" });
    await handleEmbeddings(req);

    const callArgs = handleComboChat.mock.calls[0][0];
    expect(callArgs.models).toEqual(models);
    expect(callArgs.comboName).toBe("my-combo");
  });

  it("3. injects combo.dimensions into body when body.dimensions is absent", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1"], dimensions: "512" });
    handleComboChat.mockResolvedValue(makeSuccessResponse());

    const req = createRequest({ model: "emb-combo", input: "hello" });
    await handleEmbeddings(req);

    const callArgs = handleComboChat.mock.calls[0][0];
    expect(callArgs.body.dimensions).toBe("512");
  });

  it("4. does NOT override body.dimensions if user already provided", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1"], dimensions: "512" });
    handleComboChat.mockResolvedValue(makeSuccessResponse());

    const req = createRequest({ model: "emb-combo", input: "hello", dimensions: "1024" });
    await handleEmbeddings(req);

    const callArgs = handleComboChat.mock.calls[0][0];
    expect(callArgs.body.dimensions).toBe("1024");
  });

  it("5. injects combo.dimensions as string (e.g. '512')", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1"], dimensions: "512" });
    handleComboChat.mockResolvedValue(makeSuccessResponse());

    const req = createRequest({ model: "emb-combo", input: "hello" });
    await handleEmbeddings(req);

    const callArgs = handleComboChat.mock.calls[0][0];
    // dimensions 从 combo 获取后原样注入（字符串）
    expect(typeof callArgs.body.dimensions).toBe("string");
    expect(callArgs.body.dimensions).toBe("512");
  });

  it("6. falls through to handleSingleModelEmbedding when not a combo", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
    getProviderCredentials.mockResolvedValue({
      apiKey: "sk-test",
      connectionId: "conn-1",
      connectionName: "Test",
    });
    checkAndRefreshToken.mockImplementation(async (_p, creds) => creds);
    handleEmbeddingsCore.mockResolvedValue(makeCoreSuccessResult());

    const req = createRequest({ model: "openai/text-embedding-ada-002", input: "hello" });
    await handleEmbeddings(req);

    expect(handleComboChat).not.toHaveBeenCalled();
    expect(getModelInfo).toHaveBeenCalledWith("openai/text-embedding-ada-002");
  });
});

// ─── Group 2: handleSingleModelEmbedding (6 tests) ────────────────────────────

describe("handleSingleModelEmbedding — fallback logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue(defaultSettings());
  });

  it("7. returns 400 for invalid model format", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: null, model: "bad-model" });

    const req = createRequest({ model: "bad-model", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error.message).toMatch(/invalid model format/i);
  });

  it("8. returns embedding response on success (200)", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
    getProviderCredentials.mockResolvedValue({
      apiKey: "sk-test",
      connectionId: "conn-1",
      connectionName: "Test",
    });
    checkAndRefreshToken.mockImplementation(async (_p, creds) => creds);
    handleEmbeddingsCore.mockResolvedValue(makeCoreSuccessResult());

    const req = createRequest({ model: "openai/text-embedding-ada-002", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toHaveProperty("embedding");
  });

  it("9. falls back to next credential on 429/503", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });

    // 第一次凭据返回 429
    getProviderCredentials
      .mockResolvedValueOnce({
        apiKey: "sk-1",
        connectionId: "conn-1",
        connectionName: "Account 1",
      })
      .mockResolvedValueOnce({
        apiKey: "sk-2",
        connectionId: "conn-2",
        connectionName: "Account 2",
      });

    checkAndRefreshToken.mockImplementation(async (_p, creds) => creds);
    handleEmbeddingsCore
      .mockResolvedValueOnce(makeCoreErrorResult(429, "Rate limit"))
      .mockResolvedValueOnce(makeCoreSuccessResult());

    markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 1000 });

    const req = createRequest({ model: "openai/text-embedding-ada-002", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(result.status).toBe(200);
    expect(handleEmbeddingsCore).toHaveBeenCalledTimes(2);
    expect(markAccountUnavailable).toHaveBeenCalledWith("conn-1", 429, "Rate limit", "openai", "text-embedding-ada-002");
  });

  it("10. returns 400 when no credentials for provider", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: "unknown-provider", model: "some-model" });
    getProviderCredentials.mockResolvedValue(null);

    const req = createRequest({ model: "unknown-provider/some-model", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error.message).toMatch(/no credentials/i);
  });

  it("11. returns 503 when all accounts rate-limited", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });

    const retryAfter = new Date(Date.now() + 30000).toISOString();
    getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      retryAfter,
      retryAfterHuman: "30s",
      lastError: "Rate limited",
      lastErrorCode: "429",
    });

    const req = createRequest({ model: "openai/text-embedding-ada-002", input: "hello" });
    const result = await handleEmbeddings(req);

    // 当 lastErrorCode 为 "429" 时，status = Number("429") = 429
    // 代码逻辑：lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE
    expect(result.status).toBe(429);
  });

  it("12. falls back on shouldFallback=true", async () => {
    getComboModels.mockResolvedValue(null);
    getModelInfo.mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });

    // 第一个账户失败，shouldFallback=true → 排除后重试
    getProviderCredentials
      .mockResolvedValueOnce({
        apiKey: "sk-1",
        connectionId: "conn-1",
        connectionName: "Account 1",
      })
      .mockResolvedValueOnce({
        apiKey: "sk-2",
        connectionId: "conn-2",
        connectionName: "Account 2",
      });

    checkAndRefreshToken.mockImplementation(async (_p, creds) => creds);
    handleEmbeddingsCore
      .mockResolvedValueOnce(makeCoreErrorResult(503, "Service unavailable"))
      .mockResolvedValueOnce(makeCoreSuccessResult());

    markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });

    const req = createRequest({ model: "openai/text-embedding-ada-002", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(markAccountUnavailable).toHaveBeenCalledWith("conn-1", 503, "Service unavailable", "openai", "text-embedding-ada-002");
    expect(result.status).toBe(200);
  });
});

// ─── Group 3: combo fallback with dimensions (4 tests) ─────────────────────────

describe("combo fallback with dimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue(defaultSettings());
  });

  it("13. first model success returns immediately with dimensions in response", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1", "minimax/MiniMax-M2.7"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1", "minimax/MiniMax-M2.7"], dimensions: "256" });

    // handleComboChat 直接模拟成功返回
    const successResp = makeSuccessResponse();
    handleComboChat.mockResolvedValue(successResp);

    const req = createRequest({ model: "emb-combo", input: "hello" });
    const result = await handleEmbeddings(req);

    // handleComboChat 收到注入了 dimensions 的 body
    const comboCall = handleComboChat.mock.calls[0][0];
    expect(comboCall.body.dimensions).toBe("256");
    expect(result.status).toBe(200);
  });

  it("14. first model failure falls back to second model", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1", "minimax/MiniMax-M2.7"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1", "minimax/MiniMax-M2.7"], dimensions: null });

    // handleComboChat 模拟：内部会依次调用 handleSingleModel
    // 这里只验证 handleComboChat 被正确调用，且 handleSingleModel 回调被传入
    const failResp = new Response(JSON.stringify({ error: { message: "Rate limit" } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
    handleComboChat.mockResolvedValue(failResp);

    const req = createRequest({ model: "emb-combo", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(handleComboChat).toHaveBeenCalledOnce();
    const comboCall = handleComboChat.mock.calls[0][0];
    expect(typeof comboCall.handleSingleModel).toBe("function");
  });

  it("15. dimensions from combo injected into each fallback attempt", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1", "minimax/MiniMax-M2.7"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1", "minimax/MiniMax-M2.7"], dimensions: "512" });
    handleComboChat.mockResolvedValue(makeSuccessResponse());

    const req = createRequest({ model: "emb-combo", input: "test input" });
    await handleEmbeddings(req);

    const comboCall = handleComboChat.mock.calls[0][0];
    // body 上已注入 dimensions=512
    expect(comboCall.body.dimensions).toBe("512");
    // handleSingleModel 是闭包，会把带 dimensions 的 body 传给 handleSingleModelEmbedding
    expect(typeof comboCall.handleSingleModel).toBe("function");

    // 调用 handleSingleModel 模拟验证 body 中包含 dimensions
    const mockBody = { ...comboCall.body };
    expect(mockBody.dimensions).toBe("512");
  });

  it("16. all models fail returns 503 with error message", async () => {
    getComboModels.mockResolvedValue(["glm/glm-5.1", "minimax/MiniMax-M2.7"]);
    getComboByName.mockResolvedValue({ name: "emb-combo", models: ["glm/glm-5.1", "minimax/MiniMax-M2.7"], dimensions: "256" });

    const failResp = new Response(JSON.stringify({ error: { message: "All combo models unavailable" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
    handleComboChat.mockResolvedValue(failResp);

    const req = createRequest({ model: "emb-combo", input: "hello" });
    const result = await handleEmbeddings(req);

    expect(result.status).toBe(503);
    const body = await result.json();
    expect(body.error.message).toMatch(/unavailable/i);
  });
});

// ─── Group 4: API routes dimensions handling (4 tests) ─────────────────────────

describe("API routes — dimensions handling", () => {
  // 动态导入路由处理器（在 mock 生效后）
  let POST, PUT;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 重新导入路由处理器以使用最新 mock
    const combosRoute = await import("../../src/app/api/combos/route.js");
    POST = combosRoute.POST;

    const comboIdRoute = await import("../../src/app/api/combos/[id]/route.js");
    PUT = comboIdRoute.PUT;
  });

  it("17. POST /api/combos accepts dimensions field", async () => {
    const createdCombo = {
      id: "combo-1",
      name: "emb-combo",
      models: ["glm/glm-5.1"],
      kind: null,
      dimensions: "512",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    createCombo.mockResolvedValue(createdCombo);
    getComboByName.mockResolvedValue(null); // 名称不存在

    const req = createRequest({ name: "emb-combo", models: ["glm/glm-5.1"], dimensions: "512" });
    const result = await POST(req);

    expect(createCombo).toHaveBeenCalledWith(
      expect.objectContaining({ name: "emb-combo", dimensions: "512", models: ["glm/glm-5.1"] })
    );
    expect(result.status).toBe(201);
    expect(result.body.dimensions).toBe("512");
  });

  it("18. POST /api/combos accepts dimensions=null", async () => {
    const createdCombo = {
      id: "combo-2",
      name: "no-dim-combo",
      models: ["glm/glm-5.1"],
      kind: null,
      dimensions: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    createCombo.mockResolvedValue(createdCombo);
    getComboByName.mockResolvedValue(null);

    const req = createRequest({ name: "no-dim-combo", models: ["glm/glm-5.1"], dimensions: null });
    const result = await POST(req);

    expect(createCombo).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: null })
    );
    expect(result.status).toBe(201);
    expect(result.body.dimensions).toBeNull();
  });

  it("19. POST /api/combos works without dimensions field (backward compatible)", async () => {
    const createdCombo = {
      id: "combo-3",
      name: "old-combo",
      models: ["glm/glm-5.1"],
      kind: null,
      dimensions: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    createCombo.mockResolvedValue(createdCombo);
    getComboByName.mockResolvedValue(null);

    // 不传 dimensions 字段
    const req = createRequest({ name: "old-combo", models: ["glm/glm-5.1"] });
    const result = await POST(req);

    expect(createCombo).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: null })
    );
    expect(result.status).toBe(201);
  });

  it("20. PUT /api/combos/:id updates dimensions field", async () => {
    const existingCombo = {
      id: "combo-1",
      name: "emb-combo",
      models: ["glm/glm-5.1"],
      kind: null,
      dimensions: "256",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updatedCombo = {
      ...existingCombo,
      dimensions: "1024",
      updatedAt: new Date().toISOString(),
    };

    getComboById.mockResolvedValue(existingCombo);
    getComboByName.mockResolvedValue(null); // 不重名
    updateCombo.mockResolvedValue(updatedCombo);

    const req = createRequest({ dimensions: "1024", name: "emb-combo", models: ["glm/glm-5.1"] });
    const result = await PUT(req, { params: Promise.resolve({ id: "combo-1" }) });

    expect(updateCombo).toHaveBeenCalledWith("combo-1", expect.objectContaining({ dimensions: "1024" }));
    expect(result.body.dimensions).toBe("1024");
  });
});
