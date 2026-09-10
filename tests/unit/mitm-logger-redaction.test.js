import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let logger;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mitm-redaction-"));
  process.env.DATA_DIR = tempDir;
  logger = require("../../src/mitm/logger.js");
  logger.clearDumpDir();
});

afterAll(() => {
  logger?.clearDumpDir?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("MITM logger redaction", () => {
  const request = {
    method: "POST",
    url: "/v1/chat/completions?token=url-secret",
    headers: {
      host: "provider.example",
      authorization: "Bearer header-secret",
      cookie: "session=cookie-secret",
      "content-type": "application/json",
    },
  };

  it("writes request metadata without body or sensitive headers", () => {
    const file = logger.dumpRequest(request, Buffer.from(JSON.stringify({ prompt: "request-secret" })), "test");
    const output = fs.readFileSync(file, "utf8");

    expect(output).not.toContain("request-secret");
    expect(output).not.toContain("header-secret");
    expect(output).not.toContain("cookie-secret");
    expect(output).not.toContain("url-secret");
    const parsed = JSON.parse(output);
    expect(parsed.body.present).toBe(true);
    expect(parsed.body.bytes).toBeGreaterThan(0);
    expect(parsed.headers.authorization).toBe("[REDACTED]");
  });

  it("writes response metadata without stream content or sensitive headers", () => {
    const dumper = logger.createResponseDumper(request, "test");
    dumper.writeHeader(200, {
      authorization: "Bearer response-header-secret",
      "content-type": "text/event-stream",
    });
    dumper.writeChunk("response-secret");
    dumper.end();
    const output = fs.readFileSync(dumper.file, "utf8");

    expect(output).not.toContain("response-secret");
    expect(output).not.toContain("response-header-secret");
    expect(output).toContain('"present":true');
    expect(output).toContain('"bytes":15');
    expect(output).toContain('"authorization": "[REDACTED]"');
  });
});
