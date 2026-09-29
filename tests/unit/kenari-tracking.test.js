// Integration boundary: real DefaultExecutor (registry URL/auth) -> mocked HTTP
// response -> real non-streaming handler -> saveUsageStats/canonicalizeUsage ->
// real saveRequestUsage SQLite INSERT -> real history/stats queries.
// The outer routing/auth/account-selection loop and streaming are not exercised.
// Harness: groq-usage.test.js (proxyAwareFetch) + cached-token-e2e.test.js (temp DB).
// Only upstream HTTP and request-detail observability are stubbed; the usage spy
// calls through so we can await the fire-and-forget write without sleeps/polling.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveRequestUsage: vi.fn(actual.saveRequestUsage),
    saveRequestDetail: vi.fn().mockResolvedValue(undefined),
  };
});
// The /api/usage/stats route handler is exercised directly (Gap A): mock
// NextResponse.json to a plain { body, status } object so the handler can be
// called without a Next.js runtime, mirroring proxy-pool-fitness-routes.test.js.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init?.status || 200 }),
  },
}));

const MODEL = "step-3-7-flash";
const CONNECTION_ID = "kenari-tracking-connection";
const CLIENT_KEY = "test-only-client-key";
const ENDPOINT = "/v1/chat/completions";
const TOKENS = { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 };
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let driver;
let usageDb;
let proxyAwareFetch;
let DefaultExecutor;
let handleNonStreamingResponse;
let getUsageStatsRoute;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-kenari-tracking-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  driver = await import("../../src/lib/db/driver.js");
  // resetModules alone does not reset the driver's global singleton.
  driver.closeAdapter();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  usageDb = await import("@/lib/usageDb.js");
  ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
  ({ DefaultExecutor } = await import("../../open-sse/executors/default.js"));
  ({ handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js"));
  ({ GET: getUsageStatsRoute } = await import("../../src/app/api/usage/stats/route.js"));
  vi.clearAllMocks();
});

afterAll(() => {
  try {
    driver?.closeAdapter();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    vi.restoreAllMocks();
  }
});

describe("kenari automatic request usage tracking", () => {
  it("records exactly one unbuffered usage row and makes kenari visible in stats", async () => {
    const before = await db.getUsageStats("all");
    expect(before.byProvider.kenari).toBeUndefined();
    expect(before.totalRequests).toBe(0);
    expect(await db.getUsageHistory({ provider: "kenari" })).toEqual([]);
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      id: "chatcmpl-kenari-tracking",
      object: "chat.completion",
      model: MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
      usage: TOKENS,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const body = { model: MODEL, messages: [{ role: "user", content: "Hello" }], stream: false };
    const requestStartTime = Date.now();
    const upstream = await new DefaultExecutor("kenari").execute({
      model: MODEL, body, stream: false,
      credentials: { apiKey: "test-only-upstream-key" },
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://kenari.id/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer test-only-upstream-key");
    expect(JSON.parse(options.body).model).toBe(MODEL);

    const result = await handleNonStreamingResponse({
      providerResponse: upstream.response,
      provider: "kenari", model: MODEL,
      sourceFormat: "openai", targetFormat: "openai",
      body, stream: false, finalBody: upstream.transformedBody,
      requestStartTime, connectionId: CONNECTION_ID, apiKey: CLIENT_KEY,
      clientRawRequest: { endpoint: ENDPOINT },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(), appendLog: vi.fn(),
    });
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("Hello");

    // saveUsageStats returns void; awaiting the handler alone is insufficient.
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    await Promise.all(usageDb.saveRequestUsage.mock.results.map(({ value }) => value));
    const history = await db.getUsageHistory({ provider: "kenari" });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      provider: "kenari", model: MODEL, connectionId: CONNECTION_ID,
      endpoint: ENDPOINT, tokens: { prompt_tokens: 123, completion_tokens: 45 },
    });
    // Extraction intentionally omits total_tokens: assert the stored sum, not
    // the client-facing usage, which the handler separately pads by 2000.
    expect(history[0].tokens.prompt_tokens + history[0].tokens.completion_tokens).toBe(168);
    const adapter = await driver.getAdapter();
    expect(adapter.all("SELECT provider, connectionId, apiKey, promptTokens, completionTokens FROM usageHistory")).toEqual([
      { provider: "kenari", connectionId: CONNECTION_ID, apiKey: CLIENT_KEY, promptTokens: 123, completionTokens: 45 },
    ]);

    // Both daily summaries and live history must count the single request once.
    for (const period of ["all", "24h"]) {
      const after = await db.getUsageStats(period);
      expect(after.totalRequests).toBe(1);
      expect(after.totalPromptTokens).toBe(123);
      expect(after.totalCompletionTokens).toBe(45);
      expect(after.totalPromptTokens + after.totalCompletionTokens).toBe(168);
      expect(after.byProvider.kenari).toMatchObject({
        requests: 1, promptTokens: 123, completionTokens: 45,
      });
    }

    // The HTTP-facing /api/usage/stats route (not just the DB helper it wraps)
    // must surface kenari. Call the real GET handler with period=all and assert
    // the same byProvider.kenari shape the direct getUsageStats("all") call above
    // already proved — the row written earlier in this test is what it reads.
    const routeResponse = await getUsageStatsRoute(
      new Request("http://router.test/api/usage/stats?period=all")
    );
    expect(routeResponse.status).toBe(200);
    expect(routeResponse.body.byProvider.kenari).toMatchObject({
      requests: 1, promptTokens: 123, completionTokens: 45,
    });
  });
});
