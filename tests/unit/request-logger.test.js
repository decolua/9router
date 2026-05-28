import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const originalEnableRequestLogs = process.env.ENABLE_REQUEST_LOGS;
const originalCwd = process.cwd;

async function loadLogger() {
  vi.resetModules();
  process.env.ENABLE_REQUEST_LOGS = "true";
  return await import("../../open-sse/utils/requestLogger.js");
}

describe("request logger redaction", () => {
  const tempRoot = path.join(process.cwd(), "tmp-request-logger-test");

  beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    process.cwd = () => tempRoot;
  });

  afterEach(() => {
    process.env.ENABLE_REQUEST_LOGS = originalEnableRequestLogs;
    process.cwd = originalCwd;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("masks sensitive headers, query params, and nested body values", async () => {
    const { createRequestLogger } = await loadLogger();
    const logger = await createRequestLogger(
      "openai",
      "anthropic",
      "test-model",
    );

    logger.logClientRawRequest(
      "https://provider.example.com/v1/chat?token=query-token&safe=value",
      {
        messages: [
          {
            role: "user",
            metadata: {
              password: "nested-password",
              apiKey: "nested-api-key",
              safe: "visible",
            },
          },
        ],
      },
      {
        authorization: "Bearer raw-token",
        "x-api-key": "raw-api-key",
        cookie: "session=raw-cookie",
        "content-type": "application/json",
      },
    );

    const logPath = path.join(logger.sessionPath, "1_req_client.json");
    const logContent = fs.readFileSync(logPath, "utf8");
    const logged = JSON.parse(logContent);

    expect(logContent).not.toContain("raw-token");
    expect(logContent).not.toContain("raw-api-key");
    expect(logContent).not.toContain("raw-cookie");
    expect(logContent).not.toContain("query-token");
    expect(logContent).not.toContain("nested-password");
    expect(logContent).not.toContain("nested-api-key");
    expect(logged.headers.authorization).toBe("[REDACTED]");
    expect(logged.headers["x-api-key"]).toBe("[REDACTED]");
    expect(logged.headers.cookie).toBe("[REDACTED]");
    expect(logged.body.messages[0].metadata.password).toBe("[REDACTED]");
    expect(logged.body.messages[0].metadata.apiKey).toBe("[REDACTED]");
    expect(logged.body.messages[0].metadata.safe).toBe("visible");
    expect(logged.endpoint).toContain("token=%5BREDACTED%5D");
    expect(logged.endpoint).toContain("safe=value");
  });
});
