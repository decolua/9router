import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  speech: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false }) }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "openai", model: "tts-1" }),
  getComboModels: async () => null,
}));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: (request) => request.headers.get("Authorization")?.replace(/^Bearer /, "") || null,
  isValidApiKey: async () => true,
  getProviderCredentials: mocks.credentials,
  markAccountUnavailable: async () => ({ shouldFallback: false }),
}));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: mocks.speech }));

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-cap-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  mocks.credentials.mockReset().mockResolvedValue({ connectionId: "speech-1", connectionName: "speech" });
  mocks.speech.mockReset().mockResolvedValue({ success: true, response: new Response("audio") });
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("keyed speech request persistence", () => {
  it("keeps one request's repeated accounting write idempotent and distinct requests separate", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("speech", "machine");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const { recordKeyedUsage } = await import("@/sse/services/keyAccess.js");
    const request = new Request("http://localhost/v1/audio/speech", { headers: { "x-request-id": "client-chosen" } });
    const context = { apiKey: key.key };
    const usage = { provider: "openai", model: "tts-1", tokens: {} };
    expect(await recordKeyedUsage(request, context, usage)).toBeNull();
    expect(await recordKeyedUsage(request, context, usage)).toBeNull();
    expect(await recordKeyedUsage(new Request(request.url), context, usage)).toBeNull();
    expect(adapter.get(`SELECT COUNT(*) AS count FROM usageHistory WHERE apiKey = ?`, [key.key]).count).toBe(2);
    expect(adapter.get(`SELECT COUNT(*) AS count FROM usageHistory WHERE requestId = ?`, ["client-chosen"]).count).toBe(0);
  });

  it("returns 503 after upstream success when keyed accounting fails", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("speech", "machine", { maxRequestsPerDay: 1 });
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const originalRun = adapter.run.bind(adapter);
    const failed = vi.spyOn(adapter, "run").mockImplementation((sql, ...args) => {
      if (sql.includes("INSERT INTO usageHistory")) throw new Error("usage storage failed");
      return originalRun(sql, ...args);
    });
    const { handleTts } = await import("@/sse/handlers/tts.js");
    try {
      const response = await handleTts(new Request("http://localhost/v1/audio/speech", {
        method: "POST", headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/tts-1", input: "hello" }),
      }));
      expect(response.status).toBe(503);
      expect(mocks.speech).toHaveBeenCalledTimes(1);
    } finally {
      failed.mockRestore();
    }
  });

  it("counts a handler success in SQLite and blocks the next request at the canonical cap", async () => {
    const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const key = await createApiKey("speech", "machine", { maxRequestsPerDay: 1 });
    const { getDailyUsageForApiKey } = await import("@/lib/db/repos/usageRepo.js");
    const { handleTts } = await import("@/sse/handlers/tts.js");
    const call = () => handleTts(new Request("http://localhost/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/tts-1", input: "hello" }),
    }));
    expect((await call()).status).toBe(200);
    expect((await getDailyUsageForApiKey(key.key)).requests).toBe(1);
    expect((await call()).status).toBe(429);
    expect(mocks.speech).toHaveBeenCalledTimes(1);
  });
});
