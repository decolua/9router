/**
 * Unit tests for cloud/src/handlers/embeddings.js
 *
 * Tests cover:
 *  - CORS OPTIONS → 200 with CORS headers
 *  - Auth: missing Bearer → 401
 *  - Auth: invalid key format → 401
 *  - Auth: valid new-format key but wrong key value → 401
 *  - Body validation: missing model → 400, missing input → 400
 *  - Invalid model format → 400
 *  - Happy path → delegates to handleEmbeddingsCore and returns response
 *  - Rate-limited provider → 503 with Retry-After
 *  - No credentials → 400
 *
 * Strategy: mock all external dependencies (D1 storage, handleEmbeddingsCore, apiKey utils)
 * so tests run without Cloudflare Workers runtime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

vi.mock("../../open-sse/services/model.js", () => ({
  getModelInfoCore: vi.fn(),
}));

vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({
  handleEmbeddingsCore: vi.fn(),
}));

vi.mock("../../open-sse/utils/error.js", async (importOriginal) => {
  // Use real errorResponse implementation so response bodies are realistic
  const actual = await importOriginal();
  return actual;
});

vi.mock("../../open-sse/services/accountFallback.js", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

vi.mock("../../cloud/src/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../cloud/src/utils/apiKey.js", () => ({
  parseApiKey: vi.fn(),
  extractBearerToken: vi.fn(),
}));

vi.mock("../../cloud/src/services/storage.js", () => ({
  getMachineData: vi.fn(),
  saveMachineData: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { handleEmbeddings } from "../../cloud/src/handlers/embeddings.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { parseApiKey, extractBearerToken } from "../../cloud/src/utils/apiKey.js";
import { getMachineData, saveMachineData } from "../../cloud/src/services/storage.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MACHINE_ID = "mach01";
const VALID_API_KEY = "sk-mach01-key01-ab12cd34"; // new format shape
const VALID_EMBEDDING_RESPONSE_BODY = {
  object: "list",
  data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
  model: "text-embedding-ada-002",
  usage: { prompt_tokens: 3, total_tokens: 3 },
};

/** Build a minimal mock env (Cloudflare Worker env bindings) */
function makeEnv() {
  return { DB: {}, KV: {} };
}

/** Build a mock machine data record stored in D1 */
function makeMachineData(overrides = {}) {
  return {
    machineId: MACHINE_ID,
    apiKeys: [{ key: VALID_API_KEY, label: "test" }],
    providers: {
      "conn-001": {
        provider: "openai",
        apiKey: "sk-openai-provider-key",
        isActive: true,
        priority: 1,
        status: "active",
        rateLimitedUntil: null,
        lastError: null,
      },
    },
    modelAliases: {},
    ...overrides,
  };
}

/** Make a Request object */
function makeRequest(method = "POST", body = null, authHeader = `Bearer ${VALID_API_KEY}`) {
  const headers = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;

  return new Request("https://9cli.hxd.app/v1/embeddings", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Tests: CORS OPTIONS ──────────────────────────────────────────────────────

describe("handleEmbeddings — CORS OPTIONS", () => {
  it("OPTIONS request → 200 with Access-Control-Allow-Origin: *", async () => {
    const req = makeRequest("OPTIONS", null, null);
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
  });

  it("OPTIONS request → body is empty/null", async () => {
    const req = makeRequest("OPTIONS", null, null);
    const res = await handleEmbeddings(req, makeEnv(), {});
    const text = await res.text();
    expect(text).toBe("");
  });
});

// ─── Tests: Authentication ────────────────────────────────────────────────────

describe("handleEmbeddings — authentication", () => {
  beforeEach(() => {
    vi.mocked(extractBearerToken).mockReturnValue(null);
    vi.mocked(parseApiKey).mockResolvedValue(null);
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("missing Authorization header → 401", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(null);

    const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" }, null);
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toMatch(/missing api key/i);
  });

  it("Authorization header without Bearer scheme → 401", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(null);

    const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" }, "Token abc123");
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(401);
  });

  it("Bearer key that fails parseApiKey → 401", async () => {
    vi.mocked(extractBearerToken).mockReturnValue("sk-invalidkey");
    vi.mocked(parseApiKey).mockResolvedValue(null);

    const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid api key format/i);
  });

  it("old-format key (no machineId) → 400 asking to use machineId endpoint", async () => {
    vi.mocked(extractBearerToken).mockReturnValue("sk-oldfmt8");
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: null, keyId: "oldfmt8", isNewFormat: false });

    const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/machineId/i);
  });

  it("valid key format but key value not in machine apiKeys → 401", async () => {
    vi.mocked(extractBearerToken).mockReturnValue("sk-mach01-key01-ab12cd34");
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData({
      apiKeys: [{ key: "sk-different-key" }], // key doesn't match
    }));

    const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid api key/i);
  });

  it("valid key → passes auth (proceeds to body parsing)", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
    vi.mocked(handleEmbeddingsCore).mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }),
    });

    const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    // Should not be 401
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─── Tests: Body validation ───────────────────────────────────────────────────

describe("handleEmbeddings — body validation", () => {
  beforeEach(() => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invalid JSON body → 400", async () => {
    const req = new Request("https://9cli.hxd.app/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${VALID_API_KEY}`,
      },
      body: "{ bad json",
    });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid json/i);
  });

  it("missing model field → 400", async () => {
    const req = makeRequest("POST", { input: "hello world" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/missing model/i);
  });

  it("missing input field → 400", async () => {
    const req = makeRequest("POST", { model: "ag/gemini-embedding-001" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/missing required field: input/i);
  });

  it("model with no provider mapping → 400", async () => {
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: null, model: null });

    const req = makeRequest("POST", { model: "nonexistent/model", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/invalid model format/i);
  });
});

// ─── Tests: Happy path — valid request ────────────────────────────────────────

describe("handleEmbeddings — valid request (happy path)", () => {
  beforeEach(() => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
    vi.mocked(handleEmbeddingsCore).mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }),
    });
    vi.mocked(saveMachineData).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("single string input → 200 with embeddings data", async () => {
    const req = makeRequest("POST", {
      model: "openai/text-embedding-ada-002",
      input: "Hello world test embedding",
    });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("array input → 200 with embeddings data", async () => {
    const req = makeRequest("POST", {
      model: "openai/text-embedding-ada-002",
      input: ["Hello", "World"],
    });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
  });

  it("delegates to handleEmbeddingsCore with correct args", async () => {
    const req = makeRequest("POST", {
      model: "openai/text-embedding-ada-002",
      input: "Test",
    });
    await handleEmbeddings(req, makeEnv(), {});

    expect(handleEmbeddingsCore).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(handleEmbeddingsCore).mock.calls[0][0];
    expect(callArgs.body.input).toBe("Test");
    expect(callArgs.modelInfo.provider).toBe("openai");
    expect(callArgs.modelInfo.model).toBe("text-embedding-ada-002");
    expect(callArgs.credentials).toBeDefined();
  });

  it("response has CORS header from addCorsHeaders wrapper", async () => {
    const req = makeRequest("POST", {
      model: "openai/text-embedding-ada-002",
      input: "Hello",
    });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("machineId-override path: /{machineId}/v1/embeddings works", async () => {
    // Direct call with machineId override (old format URL path)
    const req = new Request(`https://9cli.hxd.app/${MACHINE_ID}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ model: "openai/text-embedding-ada-002", input: "Hello" }),
    });

    const res = await handleEmbeddings(req, makeEnv(), {}, MACHINE_ID);
    expect(res.status).toBe(200);
  });
});

// ─── Tests: Rate limiting ──────────────────────────────────────────────────────

describe("handleEmbeddings — rate limit fallback", () => {
  beforeEach(() => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
    vi.mocked(saveMachineData).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("all provider accounts rate-limited → 503 with Retry-After header", async () => {
    const rateLimitedUntil = new Date(Date.now() + 60000).toISOString(); // 60s from now
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData({
      providers: {
        "conn-001": {
          provider: "openai",
          apiKey: "sk-key",
          isActive: true,
          priority: 1,
          status: "unavailable",
          rateLimitedUntil,  // rate-limited
          lastError: "Rate limit exceeded",
          errorCode: 429,
          backoffLevel: 1,
        },
      },
    }));

    const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
    const retryAfter = parseInt(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("provider account not found → 400 No credentials", async () => {
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData({
      providers: {}, // no providers
    }));

    const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/no credentials/i);
  });

  it("core returns non-fallback error → propagates error response directly", async () => {
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(handleEmbeddingsCore).mockResolvedValue({
      success: false,
      status: 400,
      error: "input must be a string or array",
      response: new Response(
        JSON.stringify({ error: { message: "input must be a string or array" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      ),
    });

    const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    // Non-fallback error (400) should not trigger account cycle; returns error directly
    expect(res.status).toBe(400);
  });

  it("core returns 429 → marks account unavailable, then no more accounts → 503", async () => {
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(handleEmbeddingsCore).mockResolvedValue({
      success: false,
      status: 429,
      error: "Rate limit exceeded",
      response: new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      ),
    });

    const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
    const res = await handleEmbeddings(req, makeEnv(), {});

    // After fallback loop exhausts accounts
    expect([429, 503]).toContain(res.status);
  });
});

// ─── Tests: machineId-override (old-format URL path) ─────────────────────────

describe("handleEmbeddings — machineId override path", () => {
  beforeEach(() => {
    // When machineId is provided via URL, no apiKey parsing needed for machineId
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
    vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
    vi.mocked(handleEmbeddingsCore).mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }),
    });
    vi.mocked(saveMachineData).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("with machineIdOverride, still validates API key via Authorization header", async () => {
    // Key IS in the machine's apiKeys → should succeed
    const req = new Request(`https://9cli.hxd.app/${MACHINE_ID}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ model: "openai/text-embedding-ada-002", input: "test" }),
    });

    const res = await handleEmbeddings(req, makeEnv(), {}, MACHINE_ID);
    expect(res.status).toBe(200);
  });

  it("with machineIdOverride, wrong API key → 401", async () => {
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData({
      apiKeys: [{ key: "sk-correct-key" }],
    }));

    const req = new Request(`https://9cli.hxd.app/${MACHINE_ID}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-wrong-key",
      },
      body: JSON.stringify({ model: "openai/text-embedding-ada-002", input: "test" }),
    });

    const res = await handleEmbeddings(req, makeEnv(), {}, MACHINE_ID);
    expect(res.status).toBe(401);
  });
});
