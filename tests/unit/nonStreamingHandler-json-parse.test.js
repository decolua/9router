/**
 * ISSUE-1951: Non-streaming handler JSON parse diagnostics & SSE fallback
 *
 * Tests the improved else-branch of handleNonStreamingResponse:
 *  (a) Valid JSON with non-JSON content-type → still parsed correctly
 *  (b) SSE body with wrong/missing content-type → SSE fallback path
 *  (c) Totally unparseable body → 502 + safe diagnostic snippet (truncated,
 *      no credentials/prompts)
 *  (d) Existing text/event-stream path → unchanged
 *  (e) Normal application/json → unchanged baseline
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (hoisted before imports) ────────────────────────────────────
// Mock @/lib/usageDb.js (re-exports from db/index.js which pulls in uuid etc.)
vi.mock("../../src/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn().mockResolvedValue(undefined),
  saveRequestDetail: vi.fn().mockResolvedValue(undefined),
  trackPendingRequest: vi.fn(),
  saveRequestUsage: vi.fn().mockResolvedValue(undefined),
  getActiveRequests: vi.fn().mockReturnValue([]),
  statsEmitter: { emit: vi.fn(), on: vi.fn() },
}));

// Mock translator/index.js to prevent the undici transitive import chain
// (translator/index.js → claude-to-openai.js → image.js → undici).
// Must export `register` because ollama-to-openai.js (imported by nonStreamingHandler
// to provide `translateNonStreamingResponse`) calls register() at module-init level.
vi.mock("../../open-sse/translator/index.js", () => ({
  needsTranslation: vi.fn(() => false),
  translateRequest: vi.fn(() => null),
  detectFormat: vi.fn(() => "openai"),
  register: vi.fn(),
}));

// Mock requestDetail.js helpers
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn(() => ({})),
  extractRequestConfig: vi.fn(() => ({})),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 5, completion_tokens: 10 })),
  saveUsageStats: vi.fn(),
}));

// Mock usageTracking (imports usageDb)
vi.mock("../../open-sse/utils/usageTracking.js", () => ({
  addBufferToUsage: vi.fn((u) => u),
  filterUsageForFormat: vi.fn((u) => u),
}));

// Mock claudeCloaking (imports crypto + appConstants which has provider chains)
vi.mock("../../open-sse/utils/claudeCloaking.js", () => ({
  decloakToolNames: vi.fn((body) => body),
}));

// ── SUT ───────────────────────────────────────────────────────────────────────
const { handleNonStreamingResponse } = await import(
  "../../open-sse/handlers/chatCore/nonStreamingHandler.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fake provider Response with the given body text and content-type. */
function makeResponse(bodyText, contentType = "application/json", status = 200) {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return new Response(bodyText, { status, headers });
}

/** A minimal valid OpenAI chat.completion JSON body. */
const VALID_OPENAI_JSON = JSON.stringify({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 1700000000,
  model: "test-model",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
});

/** A single valid SSE chat.completion stream followed by [DONE]. */
const VALID_SSE_BODY = [
  `data: ${JSON.stringify({ id: "chatcmpl-sse", object: "chat.completion.chunk", created: 1700000000, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] })}`,
  `data: ${JSON.stringify({ id: "chatcmpl-sse", object: "chat.completion.chunk", created: 1700000000, model: "test-model", choices: [{ index: 0, delta: { content: "!" }, finish_reason: "stop" }] })}`,
  "data: [DONE]",
].join("\n\n");

/** Minimal args for handleNonStreamingResponse. */
function makeArgs(providerResponse, overrides = {}) {
  return {
    providerResponse,
    provider: "test-provider",
    model: "test-model",
    sourceFormat: "openai",
    targetFormat: "openai",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "conn-test",
    apiKey: "test-key",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: null,
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleNonStreamingResponse — JSON parse & SSE fallback (ISSUE-1951)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── (e) Baseline: standard JSON + application/json ─────────────────────────

  it("(baseline) parses valid JSON with application/json content-type", async () => {
    const res = makeResponse(VALID_OPENAI_JSON, "application/json");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello");
    expect(args.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "200 OK" })
    );
  });

  // ── (a) Valid JSON with wrong content-type ─────────────────────────────────

  it("(a1) valid JSON body with content-type text/plain is parsed successfully", async () => {
    const res = makeResponse(VALID_OPENAI_JSON, "text/plain; charset=utf-8");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hello");
  });

  it("(a2) valid JSON body with no content-type header is parsed successfully", async () => {
    // content-type empty string → headers.get("content-type") returns null → ""
    const res = makeResponse(VALID_OPENAI_JSON, "");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hello");
  });

  it("(a3) valid JSON body with application/octet-stream content-type is parsed successfully", async () => {
    const res = makeResponse(VALID_OPENAI_JSON, "application/octet-stream");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hello");
  });

  // ── (b) SSE body with wrong/missing content-type → SSE fallback ─────────────

  it("(b1) SSE body with content-type text/plain falls back to SSE parsing and returns 200", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = makeResponse(VALID_SSE_BODY, "text/plain");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    // SSE fallback reconstructed the content from streaming chunks
    expect(body.choices[0].message.content).toBe("Hi!");
    expect(body.id).toBe("chatcmpl-sse");
    consoleSpy.mockRestore();
  });

  it("(b2) SSE body with no content-type header falls back to SSE parsing and logs a warning", async () => {
    const warnMessages = [];
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnMessages.push(args.join(" "));
    });
    const res = makeResponse(VALID_SSE_BODY, "");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    // Warning must mention provider name and "(none)" for the absent content-type
    expect(warnMessages.some((m) => m.includes("test-provider"))).toBe(true);
    expect(warnMessages.some((m) => m.includes("(none)") || m.includes("SSE"))).toBe(true);
    consoleSpy.mockRestore();
  });

  it("(b3) SSE body with application/octet-stream content-type falls back to SSE parsing", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = makeResponse(VALID_SSE_BODY, "application/octet-stream");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hi!");
    consoleSpy.mockRestore();
  });

  it("(b4) SSE fallback path still calls appendLog with 200 OK (not FAILED)", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = makeResponse(VALID_SSE_BODY, "text/plain");
    const args = makeArgs(res);

    await handleNonStreamingResponse(args);

    expect(args.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "200 OK" })
    );
    // Must NOT have been called with a FAILED status
    const failedCall = args.appendLog.mock.calls.find((c) =>
      String(c[0]?.status || "").startsWith("FAILED")
    );
    expect(failedCall).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("(b5) ambiguous data-lines do not trigger SSE fallback unless they look like chat-completions SSE", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = makeResponse('data: {"foo":"bar"}\n\n', "text/plain");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ── (d) Existing text/event-stream path unchanged ──────────────────────────

  it("(d) SSE body with correct text/event-stream content-type uses existing SSE path", async () => {
    const res = makeResponse(VALID_SSE_BODY, "text/event-stream");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hi!");
  });

  it("(d-empty) text/event-stream path returns 502 for empty/invalid SSE (existing behaviour)", async () => {
    const res = makeResponse("not sse at all", "text/event-stream");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(args.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.stringContaining("FAILED") })
    );
  });

  // ── (c) Totally unparseable body → 502 + diagnostic snippet ───────────────

  it("(c1) completely unparseable body returns 502 and logs a diagnostic snippet to console.error", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const res = makeResponse("this is not json and not sse", "application/json");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    // Must have called appendLog with FAILED status
    expect(args.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.stringContaining("FAILED") })
    );
    // Must have logged a diagnostic message (not an empty one)
    expect(errorMessages.length).toBeGreaterThan(0);
    // Diagnostic message must mention the provider name
    expect(errorMessages.some((m) => m.includes("test-provider"))).toBe(true);
    consoleSpy.mockRestore();
  });

  it("(c2) diagnostic snippet is truncated to 200 chars for long invalid bodies", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    // Body longer than 200 chars, definitely not JSON/SSE
    const longInvalidBody = "X".repeat(500) + " garbage not parseable";
    const res = makeResponse(longInvalidBody, "text/plain");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);

    const diagMsg = errorMessages.find((m) => m.includes("test-provider"));
    expect(diagMsg).toBeDefined();
    // The snippet portion should be at most 200 chars (plus context prefix + trailing note)
    // Verify the truncation note appears
    expect(diagMsg).toMatch(/truncated/i);
    // The snippet must NOT contain more than 200 X's (i.e., the full 500-char body was not dumped)
    const xMatches = diagMsg.match(/X+/);
    expect(xMatches).toBeTruthy();
    expect(xMatches[0].length).toBeLessThanOrEqual(200);
    consoleSpy.mockRestore();
  });

  it("(c3) diagnostic snippet for short invalid body contains no truncation note", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const res = makeResponse("short garbage", "text/plain");
    const args = makeArgs(res);

    await handleNonStreamingResponse(args);

    const diagMsg = errorMessages.find((m) => m.includes("test-provider"));
    expect(diagMsg).toBeDefined();
    expect(diagMsg).not.toMatch(/truncated/i);
    consoleSpy.mockRestore();
  });

  it("(c4) diagnostic snippet redacts response-side bearer tokens, cookies, api keys, and prompt-like fields", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = '{"authorization":"Bearer sk-top-secret","cookie":"sid=abc123","api_key":"k-secret","prompt":"PROMPT_CONTENT_SHOULD_NOT_LEAK","content":"MODEL_ECHO_SHOULD_NOT_LEAK"';
    const res = makeResponse(invalidBody, "text/plain");
    const args = makeArgs(res, {
      apiKey: "sk-super-secret-key",
      body: { messages: [{ role: "user", content: "REQUEST_PROMPT_SHOULD_NOT_LEAK" }] },
    });

    await handleNonStreamingResponse(args);

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain("sk-top-secret");
    expect(allLogOutput).not.toContain("sid=abc123");
    expect(allLogOutput).not.toContain("k-secret");
    expect(allLogOutput).not.toContain("PROMPT_CONTENT_SHOULD_NOT_LEAK");
    expect(allLogOutput).not.toContain("MODEL_ECHO_SHOULD_NOT_LEAK");
    expect(allLogOutput).not.toContain("sk-super-secret-key");
    expect(allLogOutput).not.toContain("REQUEST_PROMPT_SHOULD_NOT_LEAK");
    expect(allLogOutput).toContain("[REDACTED]");
    consoleSpy.mockRestore();
  });

  it("(c4b) redacts long quoted api_key values before truncation", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = `{"api_key":"${"A".repeat(260)}"`;
    const res = makeResponse(invalidBody, "text/plain");

    await handleNonStreamingResponse(makeArgs(res));

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain("AAAAA");
    expect(allLogOutput).toContain('"api_key":"[REDACTED]"');
    consoleSpy.mockRestore();
  });

  it("(c4c) redacts long quoted apiKey values before truncation", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = `{"apiKey":"${"A".repeat(260)}"`;
    const res = makeResponse(invalidBody, "text/plain");

    await handleNonStreamingResponse(makeArgs(res));

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain("AAAAA");
    expect(allLogOutput).toContain('"apiKey":"[REDACTED]"');
    consoleSpy.mockRestore();
  });

  it("(c4d) redacts quoted accessToken values even when the closing quote is missing", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = '{"accessToken":"SECRET';
    const res = makeResponse(invalidBody, "text/plain");

    await handleNonStreamingResponse(makeArgs(res));

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain("SECRET");
    expect(allLogOutput).toContain('"accessToken":"[REDACTED]"');
    consoleSpy.mockRestore();
  });

  it("(c4e) redacts quoted refreshToken values even when the closing quote is missing", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = '{"refreshToken":"SECRET';
    const res = makeResponse(invalidBody, "text/plain");

    await handleNonStreamingResponse(makeArgs(res));

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain("SECRET");
    expect(allLogOutput).toContain('"refreshToken":"[REDACTED]"');
    consoleSpy.mockRestore();
  });

  it("(c4f) redacts singular message fields even when the quoted value is cut off", async () => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = '{"message":"PROMPT_SHOULD_NOT_LEAK';
    const res = makeResponse(invalidBody, "text/plain");

    await handleNonStreamingResponse(makeArgs(res));

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain("PROMPT_SHOULD_NOT_LEAK");
    expect(allLogOutput).toContain('"message":"[REDACTED]"');
    consoleSpy.mockRestore();
  });

  it.each([
    ["api_key", "SECRET_API_KEY"],
    ["apiKey", "SECRET_CAMEL_KEY"],
    ["accessToken", "SECRET_ACCESS_TOKEN"],
    ["refreshToken", "SECRET_REFRESH_TOKEN"],
    ["message", "PROMPT_SHOULD_NOT_LEAK"],
  ])("(c4g) redacts later quoted %s fields even after an earlier unterminated non-sensitive field", async (key, secretValue) => {
    const errorMessages = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.join(" "));
    });
    const invalidBody = `{"foo":"unterminated,"${key}":"${secretValue}"}`;
    const res = makeResponse(invalidBody, "text/plain");

    await handleNonStreamingResponse(makeArgs(res));

    const allLogOutput = errorMessages.join("\n");
    expect(allLogOutput).not.toContain(secretValue);
    expect(allLogOutput).toContain(`"${key}":"[REDACTED]"`);
    consoleSpy.mockRestore();
  });

  it("(c5) empty body returns 502 and logs diagnostic snippet without crashing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeResponse("", "application/json");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    consoleSpy.mockRestore();
  });

  it("(c5b) valid JSON with a UTF-8 BOM is parsed successfully", async () => {
    const res = makeResponse(`\uFEFF${VALID_OPENAI_JSON}`, "text/plain");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hello");
  });

  it("(c6) error message returned to client names the provider but does not expose raw body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeResponse("totally invalid", "application/json");
    const args = makeArgs(res);

    const result = await handleNonStreamingResponse(args);

    expect(result.success).toBe(false);
    // The client-facing error message must not dump the full body
    const clientBody = await result.response.json();
    expect(clientBody.error.message).not.toContain("totally invalid");
    // But it does name the provider for context
    expect(clientBody.error.message).toContain("test-provider");
  });
});
