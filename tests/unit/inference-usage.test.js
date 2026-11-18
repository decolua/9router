import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const previousDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inference-usage-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();
const db = await import("@/lib/db/index.js");
await db.initDb();
afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  global._dbAdapter?.instance?.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

it("counts independent zero-token attempts at the same instant and deduplicates only their request IDs", async () => {
  const timestamp = new Date().toISOString();
  const endpoints = ["/v1/audio/speech", "/v1/audio/transcriptions", "/v1/images/generations", "/v1/videos", "/v1/embeddings", "/v1/systemone"];
  for (const [index, endpoint] of endpoints.entries()) {
    const entry = { requestId: `attempt-${index}`, timestamp, provider: "test", model: "model", connectionId: "connection", apiKey: "client-key", endpoint, tokens: {}, status: index === 1 ? "502" : "success", latencyMs: 12 };
    await db.saveRequestUsage(entry);
    await db.saveRequestUsage(entry);
  }
  const history = await db.getUsageHistory({ provider: "test" });
  expect(history.map((entry) => entry.endpoint)).toEqual(endpoints);
  expect(history.every((entry) => Object.keys(entry.tokens).length === 0)).toBe(true);
  const stats = await db.getUsageStats("24h");
  expect(stats.totalRequests).toBe(6);
  expect(Object.values(stats.byEndpoint).map((entry) => entry.requests)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(stats.recentRequests).toHaveLength(6);
  expect((await db.getActiveRequests()).recentRequests).toHaveLength(6);
});
