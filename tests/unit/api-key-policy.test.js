import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let policy;

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-policy-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  policy = await import("@/sse/services/apiKeyPolicy.js");
}

beforeAll(async () => {
  await loadFreshDb();
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key policy", () => {
  it("treats an empty allowedModels list as allowing every model", async () => {
    const key = await db.createApiKey("all-models", "machine-abc", { allowedModels: [] });
    const loaded = await policy.loadApiKeyPolicy(key.key);

    const result = policy.checkApiKeyModelAccess(loaded, {
      requestedModel: "anthropic/claude-3-5-sonnet",
      resolvedModels: ["anthropic/claude-3-5-sonnet"],
    });

    expect(result.allowed).toBe(true);
  });

  it("blocks chat models that are not in the API key allowlist", async () => {
    const key = await db.createApiKey("openai-only", "machine-abc", {
      allowedModels: ["openai/gpt-4o"],
    });
    const loaded = await policy.loadApiKeyPolicy(key.key);

    const result = policy.checkApiKeyModelAccess(loaded, {
      requestedModel: "anthropic/claude-3-5-sonnet",
      resolvedModels: ["anthropic/claude-3-5-sonnet"],
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });

  it("blocks combo when only one child model is allowlisted", async () => {
    const key = await db.createApiKey("partial-combo", "machine-abc", {
      allowedModels: ["openai/gpt-4o"],
    });
    const loaded = await policy.loadApiKeyPolicy(key.key);

    const result = policy.checkApiKeyComboModelAccess(loaded, "my-combo", [
      "openai/gpt-4o",
      "anthropic/claude-3-5-sonnet",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });

  it("reports daily token quota when usage reaches the API key limit", async () => {
    const key = await db.createApiKey("limited", "machine-abc", { dailyTokenLimit: 150 });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: key.key,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const loaded = await policy.loadApiKeyPolicy(key.key);
    const result = await policy.checkApiKeyDailyTokenLimit(loaded);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe(429);
    expect(result.usage.totalTokens).toBe(150);
    expect(result.limit).toBe(150);
  });
});
