import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalLogging = process.env.ENABLE_REQUEST_LOGS;
let tempDir;

async function createLogger(enabled) {
  process.env.ENABLE_REQUEST_LOGS = String(enabled);
  vi.resetModules();

  const cwd = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  try {
    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js");
    return await createRequestLogger("openai", "provider", "test/model");
  } finally {
    cwd.mockRestore();
  }
}

function readLog(logger, filename) {
  return JSON.parse(fs.readFileSync(path.join(logger.sessionPath, filename), "utf8"));
}

function mode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-logger-"));
  fs.chmodSync(tempDir, 0o755);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });

  if (originalLogging === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalLogging;
});

describe("request logger security", () => {
  it("does not create logs when request logging is disabled", async () => {
    const logger = await createLogger(false);

    logger.logClientRawRequest("/v1/chat/completions", { prompt: "hello" }, {
      Authorization: "Bearer client-key",
    });

    expect(logger.sessionPath).toBeNull();
    expect(fs.existsSync(path.join(tempDir, "logs"))).toBe(false);
  });

  it("redacts every request header path without mutating objects or Headers", async () => {
    const logger = await createLogger(true);
    const clientBody = { prompt: "client" };
    const sourceBody = { prompt: "source" };
    const targetBody = { prompt: "target" };
    const clientHeaders = {
      Authorization: "Bearer client-key",
      "Proxy-Authorization": "Basic proxy-key",
      Cookie: "session=client-cookie",
      "X-Request-ID": "request-123",
      "X-Correlation-ID": "correlation-123",
      Accept: "application/json",
    };
    const sourceHeaders = new Headers({
      "Set-Cookie": "session=provider-cookie",
      "API-Key": "source-api-key",
      "X-Goog-Api-Key": "google-api-key",
      "Refresh-Token": "source-token",
      "Client-Secret-Value": "source-secret",
      "X-Request-ID": "request-456",
      "Content-Type": "application/json",
    });
    const targetHeaders = {
      "X-API-KEY": "target-api-key",
      "x-request-id": "request-789",
      "content-type": "application/json",
    };
    const clientSnapshot = structuredClone(clientHeaders);
    const sourceSnapshot = [...sourceHeaders.entries()];
    const targetSnapshot = structuredClone(targetHeaders);

    logger.logClientRawRequest("/v1/chat/completions", clientBody, clientHeaders);
    logger.logRawRequest(sourceBody, sourceHeaders);
    logger.logTargetRequest("https://provider.example/v1/chat", targetHeaders, targetBody);

    expect(readLog(logger, "1_req_client.json")).toMatchObject({
      endpoint: "/v1/chat/completions",
      headers: {
        Authorization: "[REDACTED]",
        "Proxy-Authorization": "[REDACTED]",
        Cookie: "[REDACTED]",
        "X-Request-ID": "request-123",
        "X-Correlation-ID": "correlation-123",
        Accept: "application/json",
      },
      body: clientBody,
    });
    expect(readLog(logger, "2_req_source.json")).toMatchObject({
      headers: {
        "set-cookie": "[REDACTED]",
        "api-key": "[REDACTED]",
        "x-goog-api-key": "[REDACTED]",
        "refresh-token": "[REDACTED]",
        "client-secret-value": "[REDACTED]",
        "x-request-id": "request-456",
        "content-type": "application/json",
      },
      body: sourceBody,
    });
    expect(readLog(logger, "4_req_target.json")).toMatchObject({
      url: "https://provider.example/v1/chat",
      headers: {
        "X-API-KEY": "[REDACTED]",
        "x-request-id": "request-789",
        "content-type": "application/json",
      },
      body: targetBody,
    });
    expect(clientHeaders).toEqual(clientSnapshot);
    expect([...sourceHeaders.entries()]).toEqual(sourceSnapshot);
    expect(targetHeaders).toEqual(targetSnapshot);
  });

  it("sanitizes provider response Headers and secures new directories and files", async () => {
    const logger = await createLogger(true);
    const body = { error: "upstream response" };
    const headers = new Headers({
      Authorization: "Bearer provider-key",
      "Set-Cookie": "session=provider-cookie",
      "Response-Token": "provider-token",
      "X-Request-ID": "provider-request-123",
      "Content-Type": "application/json",
    });
    const snapshot = [...headers.entries()];

    logger.logProviderResponse(401, "Unauthorized", headers, body);
    logger.appendProviderChunk("provider");
    logger.appendOpenAIChunk("openai");
    logger.appendConvertedChunk("client");

    expect(readLog(logger, "5_res_provider.json")).toMatchObject({
      status: 401,
      statusText: "Unauthorized",
      headers: {
        authorization: "[REDACTED]",
        "set-cookie": "[REDACTED]",
        "response-token": "[REDACTED]",
        "x-request-id": "provider-request-123",
        "content-type": "application/json",
      },
      body,
    });
    expect([...headers.entries()]).toEqual(snapshot);

    expect(mode(tempDir)).toBe(0o755);
    expect(mode(path.join(tempDir, "logs"))).toBe(0o700);
    expect(mode(logger.sessionPath)).toBe(0o700);
    expect(mode(path.join(logger.sessionPath, "5_res_provider.json"))).toBe(0o600);
    expect(mode(path.join(logger.sessionPath, "5_res_provider.txt"))).toBe(0o600);
    expect(mode(path.join(logger.sessionPath, "6_res_openai.txt"))).toBe(0o600);
    expect(mode(path.join(logger.sessionPath, "7_res_client.txt"))).toBe(0o600);
  });
});
