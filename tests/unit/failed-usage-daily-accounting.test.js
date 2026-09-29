// Integration: real SQLite (temp DATA_DIR) proving failed-request usage rows
// persisted by chatCore's failure paths (status:"error") count toward an API
// key's daily request/spend limits the same as successful rows — the PRD S2/S3
// "failure-usage coverage" gap. Only the DB layer is real here; the chatCore
// call sites that invoke saveRequestUsage(status:"error") on failure are
// covered separately in chat-dispatch-resilience.test.js and
// chat-public-dispatch-lifecycle.test.js S1-D real-policy cases.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const MACHINE_ID = "test-machine-0001";
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let driver;
let auth;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-failed-usage-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  driver = await import("../../src/lib/db/driver.js");
  driver.closeAdapter();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  auth = await import("../../src/sse/services/auth.js");
});

afterAll(() => {
  try {
    driver?.closeAdapter();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  }
});

describe("failed-request usage counts toward real daily accounting", () => {
  it("saveRequestUsage(status:error) rows raise getDailyUsageForApiKey().requests and trip the real request-limit policy check", async () => {
    const apiKey = await db.createApiKey("limit-key", MACHINE_ID, { maxRequestsPerDay: 2 });

    expect(await auth.getApiKeyPolicyError(apiKey.key, "groq/test")).toBeNull();
    expect(await db.getDailyUsageForApiKey(apiKey.key)).toMatchObject({ requests: 0 });

    for (let i = 0; i < 2; i++) {
      await db.saveRequestUsage({
        provider: "groq", model: "test", connectionId: "c-fail",
        apiKey: apiKey.key, tokens: { prompt_tokens: 0, completion_tokens: 0 },
        endpoint: "/v1/chat/completions", status: "error",
      });
    }

    const usage = await db.getDailyUsageForApiKey(apiKey.key);
    expect(usage.requests).toBe(2);

    const err = await auth.getApiKeyPolicyError(apiKey.key, "groq/test");
    expect(err).toEqual({ status: 429, message: expect.stringMatching(/Daily request limit reached \(2\/2\)/) });
  });

  it("saveRequestUsage(status:error) rows with tokens raise getDailyUsageForApiKey().cost and trip the real spend-limit policy check", async () => {
    const apiKey = await db.createApiKey("spend-key", MACHINE_ID, { maxSpendUsdPerDay: 0.001 });

    expect(await auth.getApiKeyPolicyError(apiKey.key, "openai/gpt-4o")).toBeNull();

    // gpt-4o pricing from open-sse/providers/pricing.js is well above $0.001/token,
    // so one failed request with real usage tokens is enough to cross the cap —
    // proving a failed dispatch still gets billed via the same cost calculation
    // path as a successful one (calculateCostFromTokens), not silently free.
    await db.saveRequestUsage({
      provider: "openai", model: "gpt-4o", connectionId: "c-fail-spend",
      apiKey: apiKey.key, tokens: { prompt_tokens: 5000, completion_tokens: 2000 },
      endpoint: "/v1/chat/completions", status: "error",
    });

    const usage = await db.getDailyUsageForApiKey(apiKey.key);
    expect(usage.cost).toBeGreaterThan(0.001);

    const err = await auth.getApiKeyPolicyError(apiKey.key, "openai/gpt-4o");
    expect(err).toMatchObject({ status: 429 });
    expect(err.message).toMatch(/Daily spend limit reached/);
  });

  it("failed and successful usage for the same key accumulate into one shared daily total", async () => {
    const apiKey = await db.createApiKey("mixed-key", MACHINE_ID, { maxRequestsPerDay: 3 });

    await db.saveRequestUsage({
      provider: "groq", model: "test", connectionId: "c-ok",
      apiKey: apiKey.key, tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat/completions", status: "ok",
    });
    await db.saveRequestUsage({
      provider: "groq", model: "test", connectionId: "c-fail",
      apiKey: apiKey.key, tokens: { prompt_tokens: 0, completion_tokens: 0 },
      endpoint: "/v1/chat/completions", status: "error",
    });

    expect(await auth.getApiKeyPolicyError(apiKey.key, "groq/test")).toBeNull();
    expect((await db.getDailyUsageForApiKey(apiKey.key)).requests).toBe(2);

    await db.saveRequestUsage({
      provider: "groq", model: "test", connectionId: "c-fail-2",
      apiKey: apiKey.key, tokens: { prompt_tokens: 0, completion_tokens: 0 },
      endpoint: "/v1/chat/completions", status: "error",
    });

    const err = await auth.getApiKeyPolicyError(apiKey.key, "groq/test");
    expect(err).toMatchObject({ status: 429 });
  });
});
