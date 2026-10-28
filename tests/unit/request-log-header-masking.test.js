/**
 * Request-log header masking (#4808).
 *
 * With ENABLE_REQUEST_LOGS=true the request logger writes stage files (1_req_client.json,
 * 4_req_target.json, 5_res_provider.json…) to logs/. Provider auth headers must never
 * reach those files in clear text, at any value length, on any request/response stage.
 *
 * Two layers:
 *  - maskSensitiveHeaders() pure behavior (exported from the module)
 *  - an end-to-end pass through createRequestLogger() reading the real files back
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maskSensitiveHeaders } from "open-sse/utils/requestLogger.js";

const LONG_TOKEN = "sk-proj-Abc123Def456Ghi789Jkl012";

describe("maskSensitiveHeaders (pure)", () => {
  it("returns an empty object for null/undefined/non-object input", () => {
    expect(maskSensitiveHeaders(null)).toEqual({});
    expect(maskSensitiveHeaders(undefined)).toEqual({});
    expect(maskSensitiveHeaders("Bearer x")).toEqual({});
  });

  it("masks Authorization while keeping non-sensitive headers intact", () => {
    const masked = maskSensitiveHeaders({
      "content-type": "application/json",
      "user-agent": "hermes-cli/0.21.5",
      Authorization: `Bearer ${LONG_TOKEN}`
    });
    expect(masked["content-type"]).toBe("application/json");
    expect(masked["user-agent"]).toBe("hermes-cli/0.21.5");
    expect(masked.Authorization).not.toContain(LONG_TOKEN);
    expect(masked.Authorization).toMatch(/^Bearer sk-\.\.\..{5}$/);
  });

  it("matches header keys case-insensitively and as substrings", () => {
    const masked = maskSensitiveHeaders({
      AUTHORIZATION: `Bearer ${LONG_TOKEN}`,
      "X-Api-Key": `sk-live-${LONG_TOKEN}`,
      "proxy-authorization": `Bearer ${LONG_TOKEN}`,
      "x-custom-auth-token": LONG_TOKEN
    });
    for (const value of Object.values(masked)) {
      expect(value).not.toContain(LONG_TOKEN);
    }
  });

  it("fully redacts short values — a short secret IS the whole secret", () => {
    const masked = maskSensitiveHeaders({
      Authorization: "Bearer sk-short",
      cookie: "sid=abc123",
      "x-api-key": ""
    });
    expect(masked.Authorization).toBe("[redacted]");
    expect(masked.cookie).toBe("[redacted]");
    // An empty credential reveals nothing but is still reported as redacted.
    expect(masked["x-api-key"]).toBe("[redacted]");
  });

  it("stringifies non-string values before masking", () => {
    expect(maskSensitiveHeaders({ "x-api-key": 12345678 })["x-api-key"]).toBe("[redacted]");
  });

  it("does not mutate the input object", () => {
    const input = { Authorization: `Bearer ${LONG_TOKEN}` };
    maskSensitiveHeaders(input);
    expect(input.Authorization).toBe(`Bearer ${LONG_TOKEN}`);
  });
});

describe("request logger stages end-to-end", () => {
  let tmpCwd;
  let originalCwd;
  let originalEnv;
  let originalFullHeadersEnv;
  let loggerModule;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalEnv = process.env.ENABLE_REQUEST_LOGS;
    originalFullHeadersEnv = process.env.REQUEST_LOG_FULL_HEADERS;
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "request-log-test-"));
    // The module reads the flag at import time — reset so a fresh instance sees it.
    process.env.ENABLE_REQUEST_LOGS = "true";
    delete process.env.REQUEST_LOG_FULL_HEADERS;
    vi.resetModules();
    loggerModule = await import("open-sse/utils/requestLogger.js");
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalEnv === undefined) delete process.env.ENABLE_REQUEST_LOGS;
    else process.env.ENABLE_REQUEST_LOGS = originalEnv;
    if (originalFullHeadersEnv === undefined) delete process.env.REQUEST_LOG_FULL_HEADERS;
    else process.env.REQUEST_LOG_FULL_HEADERS = originalFullHeadersEnv;
    vi.resetModules();
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  const readSessionFile = (sessionPath, name) =>
    JSON.parse(fs.readFileSync(path.join(sessionPath, name), "utf-8"));

  it("writes masked auth headers to every stage file that carries headers", async () => {
    const logger = await loggerModule.createRequestLogger("openai", "anthropic", "test/model");
    expect(logger.sessionPath).toBeTruthy();

    logger.logClientRawRequest("/v1/chat/completions", { messages: [] }, {
      Authorization: `Bearer ${LONG_TOKEN}`,
      "content-type": "application/json"
    });
    logger.logTargetRequest("https://provider.example/v1/messages", {
      "x-api-key": LONG_TOKEN
    }, { messages: [] });
    logger.logProviderResponse(200, "OK", { "set-cookie": `session=${LONG_TOKEN}; Path=/` }, { ok: true });

    const client = readSessionFile(logger.sessionPath, "1_req_client.json");
    expect(client.headers.Authorization).not.toContain(LONG_TOKEN);
    expect(client.headers["content-type"]).toBe("application/json");

    const target = readSessionFile(logger.sessionPath, "4_req_target.json");
    expect(target.headers["x-api-key"]).not.toContain(LONG_TOKEN);

    // Response-side credentials (set-cookie) are masked too.
    const provider = readSessionFile(logger.sessionPath, "5_res_provider.json");
    expect(provider.headers["set-cookie"]).not.toContain(LONG_TOKEN);

    // The raw credential must appear nowhere in any written file.
    for (const file of fs.readdirSync(logger.sessionPath)) {
      const content = fs.readFileSync(path.join(logger.sessionPath, file), "utf-8");
      expect(content).not.toContain(LONG_TOKEN);
    }
  });

  it("returns a no-op logger when logging is disabled", async () => {
    process.env.ENABLE_REQUEST_LOGS = "false";
    vi.resetModules();
    const fresh = await import("open-sse/utils/requestLogger.js");
    const logger = await fresh.createRequestLogger("openai", "anthropic", "test/model");
    expect(logger.sessionPath).toBeNull();
    logger.logClientRawRequest("/v1/chat/completions", {}, { Authorization: "Bearer x" });
  });

  it("writes verbatim headers only with the explicit REQUEST_LOG_FULL_HEADERS opt-in", async () => {
    process.env.REQUEST_LOG_FULL_HEADERS = "true";
    vi.resetModules();
    const fresh = await import("open-sse/utils/requestLogger.js");
    const logger = await fresh.createRequestLogger("openai", "anthropic", "test/model");
    logger.logTargetRequest("https://provider.example/v1/messages", {
      Authorization: `Bearer ${LONG_TOKEN}`
    }, {});
    const target = readSessionFile(logger.sessionPath, "4_req_target.json");
    expect(target.headers.Authorization).toBe(`Bearer ${LONG_TOKEN}`);
  });
});
