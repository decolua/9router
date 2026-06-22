import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-log-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("appendRequestLog", () => {
  it("records token-bearing CLI request events in usage history", async () => {
    await db.appendRequestLog({
      provider: "opencode-go",
      model: "glm-5.2",
      connectionId: "conn-1",
      tokens: { prompt_tokens: 42, completion_tokens: 7 },
      status: "200 OK",
    });

    const history = await db.getUsageHistory({ provider: "opencode-go" });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      provider: "opencode-go",
      model: "glm-5.2",
      connectionId: "conn-1",
      status: "200 OK",
    });
    expect(history[0].tokens).toMatchObject({ prompt_tokens: 42, completion_tokens: 7 });

    const stats = await db.getUsageStats("24h");
    expect(stats.recentRequests[0]).toMatchObject({
      provider: "opencode-go",
      model: "glm-5.2",
      promptTokens: 42,
      completionTokens: 7,
    });
  });

  it("does not add empty 0/0 request events to usage history", async () => {
    await db.appendRequestLog({
      provider: "opencode-go",
      model: "qwen3.7-max",
      connectionId: "conn-1",
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      status: "FAILED 502",
    });

    const history = await db.getUsageHistory({ provider: "opencode-go" });
    expect(history).toHaveLength(1);
    expect(history[0].model).toBe("glm-5.2");
  });
});
