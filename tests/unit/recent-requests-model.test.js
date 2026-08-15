import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-recent-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const { getActiveRequests } = await import("@/lib/db/repos/usageRepo.js");
  return {
    getActiveRequests,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("recent requests model display", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    if (global._recentRing) {
      global._recentRing.items = [];
      global._recentRing.initialized = true; // skip DB re-init in tests
    }
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("carries resolved model and requested model separately, with no arrow join", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const { buildRecentRequestRow } = await import("@/lib/db/repos/usageRepo.js");

    const row = buildRecentRequestRow({
      timestamp: "2026-08-15T10:00:00.000Z",
      provider: "opencode",
      model: "big-pickle",
      requestedModel: "oc/big-pickle",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      status: "ok",
    });

    expect(row.model).toBe("big-pickle");
    expect(row.requestedModel).toBe("oc/big-pickle");
    expect(row.provider).toBe("opencode");
    expect(JSON.stringify(row)).not.toContain("→");
  });

  it("parses requestedModel from the DB meta JSON string", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const { buildRecentRequestRow } = await import("@/lib/db/repos/usageRepo.js");

    const row = buildRecentRequestRow({
      timestamp: "2026-08-15T10:00:00.000Z",
      provider: "opencode",
      model: "big-pickle",
      tokens: JSON.stringify({ prompt_tokens: 10, completion_tokens: 5 }),
      meta: JSON.stringify({ requestedModel: "oc/big-pickle" }),
      status: "ok",
    });

    expect(row.model).toBe("big-pickle");
    expect(row.requestedModel).toBe("oc/big-pickle");
    expect(row.promptTokens).toBe(10);
  });

  it("dedupes prefixed and bare forms of the same request into one row", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    global._recentRing.items.push(
      { timestamp: "2026-08-15T10:00:00.000Z", provider: "opencode", model: "big-pickle", requestedModel: "oc/big-pickle", tokens: { prompt_tokens: 10, completion_tokens: 5 }, status: "ok" },
      { timestamp: "2026-08-15T10:00:00.000Z", provider: "opencode", model: "big-pickle", requestedModel: "big-pickle", tokens: { prompt_tokens: 10, completion_tokens: 5 }, status: "ok" },
    );

    const { recentRequests } = await ctx.getActiveRequests();
    expect(recentRequests).toHaveLength(1);
    expect(recentRequests[0].model).toBe("big-pickle");
    expect(JSON.stringify(recentRequests)).not.toContain("→");
  });

  it("drops zero-token rows (pending placeholders) from the listing", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    global._recentRing.items.push(
      { timestamp: "2026-08-15T10:00:00.000Z", provider: "opencode", model: "big-pickle", tokens: {}, status: "PENDING" },
      { timestamp: "2026-08-15T10:01:00.000Z", provider: "opencode", model: "deepseek-v4-flash-free", tokens: { prompt_tokens: 5, completion_tokens: 3 }, status: "ok" },
    );

    const { recentRequests } = await ctx.getActiveRequests();
    expect(recentRequests).toHaveLength(1);
    expect(recentRequests[0].model).toBe("deepseek-v4-flash-free");
  });
});
