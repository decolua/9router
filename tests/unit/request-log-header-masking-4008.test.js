import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Issue #4008: `maskSensitiveHeaders` was a pass-through ("DISABLED - keep full token
// for testing"), so with ENABLE_REQUEST_LOGS=true every request wrote the upstream
// Authorization / x-api-key header and the client's own into logs/ in clear text. The
// README points operators at that flag to debug a problem, so the ordinary sequence
// ended with logs/ attached to a ticket and the tokens with it.
//
// The logger reads ENABLE_REQUEST_LOGS and resolves logs/ from process.cwd() at MODULE
// LOAD, so the env var and the working directory are set before the dynamic import.

const LOGS_ROOT = mkdtempSync(join(tmpdir(), "r9-logmask-"));
const originalCwd = process.cwd();
const originalFlag = process.env.ENABLE_REQUEST_LOGS;

let createRequestLogger;

beforeAll(async () => {
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.chdir(LOGS_ROOT);
  ({ createRequestLogger } = await import("../../open-sse/utils/requestLogger.js"));
});

afterAll(() => {
  process.chdir(originalCwd);
  if (originalFlag === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalFlag;
});

function readSessionFile(sessionPath, filename) {
  return JSON.parse(readFileSync(join(sessionPath, filename), "utf8"));
}

const TOKEN = "Bearer ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

describe("request-log header masking (#4008)", () => {
  it("does not write a provider credential to logs/", async () => {
    const logger = await createRequestLogger("openai", "gemini", "gemini-3-pro");
    expect(logger.sessionPath).toBeTruthy();

    logger.logClientRawRequest("/v1/chat/completions", { model: "x" }, {
      authorization: TOKEN,
      "content-type": "application/json",
    });
    logger.logTargetRequest("https://upstream.example/v1/chat", {
      Authorization: TOKEN,
      "x-goog-api-key": "AIzaSyShortKey",
      "x-api-key": "sk-ant-0123456789abcdefghij",
      Cookie: "session=abcdefghijklmnopqrstuvwxyz",
      "content-type": "application/json",
    }, { model: "x" });
    logger.logProviderResponse(200, "OK", { "set-cookie": "sid=abcdefghijklmnopqrstuvwxyz" }, {});

    const target = readSessionFile(logger.sessionPath, "4_req_target.json");
    const client = readSessionFile(logger.sessionPath, "1_req_client.json");
    const response = readSessionFile(logger.sessionPath, "5_res_provider.json");

    // Nothing a credential could be recovered from, in any of the three files.
    const written = [target, client, response].map((f) => JSON.stringify(f)).join("\n");
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain("sk-ant-0123456789abcdefghij");
    expect(written).not.toContain("AIzaSyShortKey");
    expect(written).not.toContain("session=abcdefghijklmnopqrstuvwxyz");
    expect(written).not.toContain("sid=abcdefghijklmnopqrstuvwxyz");

    // Enough survives to tell two credentials apart, which is what the log is for.
    expect(target.headers.Authorization).toBe("Bearer ya2...xxxxx");
    expect(target.headers["x-api-key"]).toBe("sk-ant-012...fghij");
    // A short value is masked WHOLE: the version that shipped commented out here let
    // anything 20 characters or under through untouched.
    expect(target.headers["x-goog-api-key"]).toBe("***");

    // Non-sensitive headers are untouched, so the log still says what was sent.
    expect(target.headers["content-type"]).toBe("application/json");
    expect(target.url).toBe("https://upstream.example/v1/chat");
  });

  it("leaves a request with no headers alone", async () => {
    const logger = await createRequestLogger("openai", "openai", "gpt-4o");
    logger.logTargetRequest("https://upstream.example/v1/chat", undefined, { model: "x" });
    expect(readSessionFile(logger.sessionPath, "4_req_target.json").headers).toEqual({});
  });

  it("writes one session folder per logger", () => {
    expect(readdirSync(join(LOGS_ROOT, "logs")).length).toBe(2);
  });
});
