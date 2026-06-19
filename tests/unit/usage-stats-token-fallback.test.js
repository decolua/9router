import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(() => []),
}));

vi.mock("../../src/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: vi.fn(() => []),
}));

vi.mock("../../src/lib/db/repos/nodesRepo.js", () => ({
  getProviderNodes: vi.fn(() => []),
}));

describe("usage stats token fallback", () => {
  let dataDir;
  let usageRepo;

  beforeEach(async () => {
    vi.resetModules();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "9router-usage-stats-"));
    process.env.DATA_DIR = dataDir;
    delete global._dbAdapter;
    delete global._pendingRequests;
    delete global._lastErrorProvider;
    delete global._statsEmitter;
    delete global._pendingTimers;
    delete global._recentRing;
    delete global._connectionMapCache;

    usageRepo = await import("../../src/lib/db/repos/usageRepo.js");
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("counts today usage rows stored with input_tokens/output_tokens", async () => {
    await usageRepo.saveRequestUsage({
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-5.5",
      tokens: {
        input_tokens: 123,
        output_tokens: 45,
      },
    });

    const stats = await usageRepo.getUsageStats("today");

    expect(stats.totalRequests).toBe(1);
    expect(stats.totalPromptTokens).toBe(123);
    expect(stats.totalCompletionTokens).toBe(45);
    expect(stats.byProvider.openai).toMatchObject({
      requests: 1,
      promptTokens: 123,
      completionTokens: 45,
    });
  });
});
