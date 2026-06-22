/**
 * Tests for Issue #1956 – Headroom persistence and invocation in the live chat path.
 *
 * Three gaps being verified/fixed:
 *
 * 1. Settings persistence: headroomEnabled saved to DB and read back correctly.
 * 2. chatCore integration: compressWithHeadroom (fetch /v1/compress) IS called when
 *    headroomEnabled=true is passed to handleChatCore.
 * 3. responsesHandler gap: handleResponsesCore was missing headroom params in its
 *    handleChatCore call – after the fix those params flow through correctly.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach,
} from "vitest";

// ─── Shared executor / translator / logger mocks ─────────────────────────────
// (Same pattern as chatcore-outbound-validation.test.js)

const executorExecute = vi.fn();

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: executorExecute,
    refreshCredentials: vi.fn(),
  }),
}));

vi.mock(
  import("../../open-sse/translator/index.js"),
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      translateRequest: (..._args) => ({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
      }),
    };
  },
);

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: () => {},
    logRawRequest: () => {},
    logTargetRequest: () => {},
    logOpenAIRequest: () => {},
    logError: () => {},
  }),
}));

vi.mock("../../open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    PAYMENT_REQUIRED: 402,
    RATE_LIMITED: 429,
    SERVICE_UNAVAILABLE: 503,
    BAD_GATEWAY: 502,
  },
  get VALIDATE_OUTBOUND() {
    return (
      process.env.VALIDATE_OUTBOUND == null ||
      /^(1|true|yes|on)$/i.test(process.env.VALIDATE_OUTBOUND)
    );
  },
  FETCH_CONNECT_TIMEOUT_MS: 60_000,
  DEFAULT_RETRY_CONFIG: {},
  STREAM_STALL_TIMEOUT_MS: 360_000,
  STREAM_FIRST_CHUNK_TIMEOUT_MS: 200_000,
  CACHE_TTL: {},
  MEMORY_CONFIG: {},
  ERROR_TYPES: {},
  DEFAULT_ERROR_MESSAGES: {},
  BACKOFF_CONFIG: {},
  COOLDOWN_MS: 0,
  SKIP_PATTERNS: [],
}));

vi.mock("../../src/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn().mockResolvedValue(undefined),
  saveRequestDetail: vi.fn().mockResolvedValue(undefined),
}));

// ─── Dynamic imports after mocks are in place ────────────────────────────────
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HEADROOM_URL = "http://localhost:8787";

const baseBody = {
  model: "gpt-4o",
  messages: [{ role: "user", content: "hello" }],
};

/** Minimal success response that the mock executor returns */
function makeExecutorSuccessResponse() {
  return {
    response: new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json" },
    transformedBody: {},
  };
}

/** Minimal headroom /v1/compress success response */
function makeHeadroomResponse(inputMessages) {
  return new Response(
    JSON.stringify({
      messages: inputMessages.map((m) => ({ ...m, content: "short" })),
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  executorExecute.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.VALIDATE_OUTBOUND;
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 – Settings persistence round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("headroom settings persistence (DB round-trip)", () => {
  // We create an isolated in-process SQLite DB for each describe block.
  const origDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-headroom-persist-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("../../src/lib/db/index.js");
    await db.initDb();
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
  });

  it("headroomEnabled defaults to false and headroomUrl defaults to http://localhost:8787", async () => {
    const settings = await db.getSettings();
    expect(settings.headroomEnabled).toBe(false);
    expect(settings.headroomUrl).toBe("http://localhost:8787");
  });

  it("toggle ON: headroomEnabled persists as true", async () => {
    await db.updateSettings({ headroomEnabled: true });
    const after = await db.getSettings();
    expect(after.headroomEnabled).toBe(true);
  });

  it("headroomUrl persists independently; headroomEnabled survives a URL-only patch", async () => {
    // Simulate what the probe auto-apply does: only patches headroomUrl.
    await db.updateSettings({ headroomEnabled: true, headroomUrl: HEADROOM_URL });
    // Probe detects and patches URL only (not enabled flag):
    await db.updateSettings({ headroomUrl: "http://127.0.0.1:8787" });
    const settings = await db.getSettings();
    // headroomEnabled must NOT have been reset by the URL-only update:
    expect(settings.headroomEnabled).toBe(true);
    expect(settings.headroomUrl).toBe("http://127.0.0.1:8787");
  });

  it("toggle OFF: headroomEnabled persists as false; headroomUrl is preserved", async () => {
    await db.updateSettings({ headroomEnabled: true, headroomUrl: HEADROOM_URL });
    await db.updateSettings({ headroomEnabled: false });
    const after = await db.getSettings();
    expect(after.headroomEnabled).toBe(false);
    expect(after.headroomUrl).toBe(HEADROOM_URL); // URL is kept
  });

  it("custom headroomUrl persists across settings reads", async () => {
    const customUrl = "http://localhost:9999";
    await db.updateSettings({ headroomEnabled: true, headroomUrl: customUrl });
    const re = await db.getSettings();
    expect(re.headroomEnabled).toBe(true);
    expect(re.headroomUrl).toBe(customUrl);
  });

  it("getSettings after updateSettings returns merged view (other keys preserved)", async () => {
    await db.updateSettings({ headroomEnabled: true, headroomUrl: HEADROOM_URL, rtkEnabled: false });
    const s = await db.getSettings();
    // Headroom toggled on
    expect(s.headroomEnabled).toBe(true);
    expect(s.headroomUrl).toBe(HEADROOM_URL);
    // Other key explicitly set
    expect(s.rtkEnabled).toBe(false);
    // Unrelated default preserved
    expect(typeof s.requireLogin).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 – handleChatCore integration: headroom fetch fired when enabled
// ─────────────────────────────────────────────────────────────────────────────

describe("handleChatCore headroom invocation", () => {
  it("calls /v1/compress when headroomEnabled=true and url is provided", async () => {
    // Set up executor to return success so handleChatCore reaches completion.
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // The headroom fetch returns success; any other fetch should not happen
    // because the executor is mocked.
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        return makeHeadroomResponse(baseBody.messages);
      }
      // Fallback: should not be reached in this test
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false"; // skip validation for this test

    await handleChatCore({
      body: { ...baseBody },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-headroom-enabled",
      headroomEnabled: true,
      headroomUrl: HEADROOM_URL,
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    const headroomCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/v1/compress"),
    );
    expect(headroomCalls.length).toBe(1);
    expect(headroomCalls[0][0]).toBe(`${HEADROOM_URL}/v1/compress`);
    expect(headroomCalls[0][1]?.method).toBe("POST");
  });

  it("does NOT call /v1/compress when headroomEnabled=false", async () => {
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        throw new Error("headroom should not be called when disabled");
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    await handleChatCore({
      body: { ...baseBody },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-headroom-disabled",
      headroomEnabled: false,
      headroomUrl: HEADROOM_URL,
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    const headroomCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/v1/compress"),
    );
    expect(headroomCalls.length).toBe(0);
  });

  it("does NOT call /v1/compress when headroomEnabled is omitted (undefined → falsy)", async () => {
    // This is the pre-fix behavior of responsesHandler.js: callers that omit
    // headroomEnabled must not trigger compression (fail-safe, not fail-open).
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        throw new Error("headroom must not fire when headroomEnabled is undefined");
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    // headroomEnabled and headroomUrl are intentionally NOT passed
    await handleChatCore({
      body: { ...baseBody },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-headroom-undefined",
      // headroomEnabled and headroomUrl omitted
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    const headroomCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/v1/compress"),
    );
    expect(headroomCalls.length).toBe(0);
  });

  it("fails open: continues to completion even when headroom /v1/compress returns 500", async () => {
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        // Headroom service is down – should fail open (not error the entire chat)
        return new Response(JSON.stringify({ error: "internal" }), { status: 500 });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    const result = await handleChatCore({
      body: { ...baseBody },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-headroom-fail-open",
      headroomEnabled: true,
      headroomUrl: HEADROOM_URL,
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    // The request should succeed regardless of the headroom failure
    expect(result.success).toBe(true);
    // And the executor WAS still called (routing was not aborted)
    expect(executorExecute).toHaveBeenCalledTimes(1);
  });

  it("calls /v1/compress with openai-responses (input array) body and uses correct key", async () => {
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let capturedBody = null;
    fetchSpy.mockImplementation(async (url, opts) => {
      if (String(url).endsWith("/v1/compress")) {
        capturedBody = JSON.parse(opts.body);
        return new Response(
          JSON.stringify({
            messages: [{ role: "user", content: "compressed" }],
            tokens_saved: 30,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    // body uses `input` (OpenAI Responses API format)
    const responsesBody = {
      model: "gpt-4o",
      input: [{ role: "user", content: "long context here" }],
    };

    await handleChatCore({
      body: responsesBody,
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-headroom-input-key",
      headroomEnabled: true,
      headroomUrl: HEADROOM_URL,
      sourceFormatOverride: "openai-responses",
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    // Headroom received the input array as `messages` in the compress payload
    expect(capturedBody).not.toBeNull();
    expect(Array.isArray(capturedBody.messages)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3 – handleResponsesCore: headroom params now propagate (bug #1956 fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("handleResponsesCore headroom propagation (bug #1956 fix)", () => {
  it("passes headroomEnabled=true through to handleChatCore → /v1/compress is called", async () => {
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        return makeHeadroomResponse([{ role: "user", content: "hello" }]);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    // Simulate a Responses API request body
    const responsesApiBody = {
      model: "openai/gpt-4o",
      input: [{ role: "user", content: "hello from responses api" }],
    };

    await handleResponsesCore({
      body: responsesApiBody,
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-responses-headroom",
      // These are the params that were missing before the fix:
      headroomEnabled: true,
      headroomUrl: HEADROOM_URL,
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    const headroomCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/v1/compress"),
    );
    expect(headroomCalls.length).toBe(1);
    expect(headroomCalls[0][0]).toBe(`${HEADROOM_URL}/v1/compress`);
  });

  it("does NOT call /v1/compress when headroomEnabled=false on responses path", async () => {
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        throw new Error("headroom must not fire when disabled on responses path");
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    const responsesApiBody = {
      model: "openai/gpt-4o",
      input: [{ role: "user", content: "hello" }],
    };

    const result = await handleResponsesCore({
      body: responsesApiBody,
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-responses-no-headroom",
      headroomEnabled: false,
      headroomUrl: HEADROOM_URL,
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    const headroomCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/v1/compress"),
    );
    expect(headroomCalls.length).toBe(0);
    // Request should still succeed
    expect(result.success).toBe(true);
  });

  it("does NOT call /v1/compress when headroomEnabled is omitted (pre-fix behaviour was always this)", async () => {
    // This test demonstrates the pre-fix gap: handleResponsesCore without
    // headroomEnabled always had headroom silently disabled because the param
    // was never passed to handleChatCore.
    // After the fix the CALLER controls this, defaulting to undefined → disabled.
    executorExecute.mockResolvedValue(makeExecutorSuccessResponse());

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/compress")) {
        throw new Error("headroom must not fire when not passed");
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    process.env.VALIDATE_OUTBOUND = "false";

    const responsesApiBody = {
      model: "openai/gpt-4o",
      input: [{ role: "user", content: "hello" }],
    };

    // Neither headroomEnabled nor headroomUrl passed → headroom stays off
    const result = await handleResponsesCore({
      body: responsesApiBody,
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { accessToken: "sk-test" },
      connectionId: "c-responses-omit-headroom",
      log: { debug: () => {}, warn: () => {}, info: () => {} },
    });

    const headroomCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/v1/compress"),
    );
    expect(headroomCalls.length).toBe(0);
    expect(result.success).toBe(true);
  });
});
