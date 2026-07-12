import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let dbApi;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-clients-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  dbApi = await import("@/lib/db/index.js");
  await dbApi.initDb();
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key client activity", () => {
  it("records clients, attributes token usage, and reports active-key risk", async () => {
    const key = await dbApi.createApiKey("desktop-key", "machine-1");
    const first = await dbApi.recordApiKeyClientRequest(key.key, {
      fingerprint: "a".repeat(32),
      clientLabel: "home-pc",
      clientFamily: "codex",
      maskedNetwork: "203.0.113.*",
      ipSource: "cloudflare-worker",
    }, "/v1/responses");

    await dbApi.recordApiKeyClientRequest(key.key, {
      fingerprint: "a".repeat(32),
      clientLabel: "home-pc",
      clientFamily: "codex",
      maskedNetwork: "203.0.113.*",
      ipSource: "cloudflare-worker",
    }, "/v1/responses");

    await dbApi.saveRequestUsage({
      provider: "codex",
      model: "gpt-test",
      apiKey: key.key,
      tokens: { prompt_tokens: 100, completion_tokens: 20, reasoning_tokens: 5 },
      meta: {
        apiKeyId: first.apiKeyId,
        apiKeyClientFingerprint: first.fingerprint,
      },
    });

    await dbApi.recordApiKeyClientRequest(key.key, {
      fingerprint: "b".repeat(32),
      clientLabel: "work-pc",
      clientFamily: "codex",
      maskedNetwork: "198.51.100.*",
      ipSource: "cloudflare",
    }, "/v1/responses");

    const activity = await dbApi.getApiKeyClientActivity("24h");
    expect(activity.clients).toHaveLength(2);
    expect(activity.summaries).toEqual([expect.objectContaining({
      apiKeyId: key.id,
      activeClients: 2,
      distinctClients: 2,
      risk: "review",
    })]);

    const home = activity.clients.find((client) => client.clientLabel === "home-pc");
    expect(home).toEqual(expect.objectContaining({
      seenRequests: 2,
      requests: 1,
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 5,
      maskedNetwork: "203.0.113.*",
    }));

    const adapter = await import("@/lib/db/driver.js").then((module) => module.getAdapter());
    const stored = adapter.all(`SELECT * FROM apiKeyClients`);
    expect(JSON.stringify(stored)).not.toContain("203.0.113.20");

    await dbApi.deleteApiKey(key.id);
    expect(adapter.get(`SELECT COUNT(*) AS count FROM apiKeyClients`).count).toBe(0);
  });
});
