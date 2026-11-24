import { it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyInferenceError } from "open-sse/services/inferenceError.js";
import { NextRequest } from "next/server";

const dir = mkdtempSync(join(tmpdir(), "inference-health-"));
let db, derive, observeConnection, providerHealth, endpoint;
const now = Date.parse("2026-01-02T00:00:00Z");
const date = ms => new Date(ms).toISOString();
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  const unavailable = () => { throw new Error("simulated unavailable"); };
  vi.doMock("@/lib/db/adapters/bunSqliteAdapter.js", unavailable);
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", unavailable);
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", unavailable);
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  expect(db.driver).toBe("sql.js");
  ({ deriveConnectionState: derive, observeConnection, providerHealth } = await import("@/lib/observability/providerHealth.js"));
  endpoint = (await import("@/app/api/providers/health/route.js")).GET;
});
afterAll(() => { db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

it.each([
  [{ status: 401 }, "auth_expired"], [{ status: 401, refreshFailed: true }, "auth_invalid"],
  [{ status: 400, body: { error: "invalid_grant" } }, "auth_invalid"],
  [{ status: 403, body: "refresh_token_reused" }, "auth_invalid"],
  [{ status: 401, body: "access token has been revoked" }, "auth_invalid"],
  [{ status: 429, headers: new Headers({ "Retry-After": "20" }) }, "rate_limited", now+20000],
  [{ status: 429, headers: { "x-ratelimit-reset-requests": "1m5s" } }, "rate_limited", now+65000],
  [{ status: 429, headers: { "anthropic-ratelimit-tokens-reset": date(now+1000) } }, "rate_limited", now+1000],
  [{ status: 429, body: { error: { code: "insufficient_quota" } } }, "quota_exhausted"],
  [{ status: 429 }, "rate_limited"], [{ status: 503 }, "upstream_error"],
  [{ status: 504 }, "timeout"], [{ error: new Error("ETIMEDOUT") }, "timeout"],
  [{ error: new TypeError("fetch failed") }, "network"], [{ status: 422 }, "bad_request"], [{}, "unknown"],
])("classifies %j as %s without guessing reset", (input, category, ms) => {
  expect(classifyInferenceError({ ...input, now })).toEqual({ category, rateLimitResetAt: ms ? date(ms) : null });
});

it.each([
  [{}, "unknown"], [{ tested: "active" }, "healthy"], [{ locked: true }, "degraded"],
  [{ isActive: false, lastErrorCategory: "auth_invalid" }, "disabled"],
  [{ lastErrorCategory: "auth_invalid" }, "needs_reauth"], [{ lastErrorCategory: "auth_expired" }, "degraded"],
  [{ lastErrorCategory: "auth_invalid", lastSuccessAt: date(now) }, "healthy"],
  [{ lastErrorCategory: "rate_limited", rateLimitResetAt: date(now+1000) }, "rate_limited"],
  [{ unavailable: true }, "unavailable"],
])("derives state %j: %s", (fields, state) => {
  expect(derive({ isActive: true, lastErrorAt: date(now-100), ...fields }, now)).toBe(state);
});

it("aggregates last 24h in SQLite and exposes no stored credentials or raw error", async () => {
  const { updateSettings, createProviderConnection } = await import("@/lib/db/index.js");
  await updateSettings({ requireLogin: false });
  const conn = await createProviderConnection({ provider: "example", authType: "oauth", name: "label secret-key-42",
    email: "private@test.example", accessToken: "token-secret-41", refreshToken: "refresh-secret-43",
    apiKey: "secret-key-42", lastError: "sensitive upstream detail", lastErrorAt: date(Date.now()-100), errorCode: 401 });
  const t = Date.now();
  for (const [ms,lat,status] of [[t-86401000,999,"error"],[t-500,10,"ok"],[t-400,20,"success"],[t-100,null,"error"]]) {
    db.run("INSERT INTO usageHistory(timestamp,connectionId,status,promptTokens,completionTokens,meta) VALUES(?,?,?,?,?,?)",
      [date(ms),conn.id,status,3,2,JSON.stringify({ latencyMs: lat })]);
  }
  const resp = await endpoint(new NextRequest("http://localhost/api/providers/health"));
  expect(resp.status).toBe(200);
  const bytes = await resp.text();
  for (const secret of ["private@test.example","token-secret-41","refresh-secret-43","secret-key-42","sensitive upstream detail","accessToken","apiKey","refreshToken"])
    expect(bytes).not.toContain(secret);
  expect(JSON.parse(bytes).connections.find(c => c.id === conn.id)).toMatchObject({
    state: "degraded", lastErrorCategory: "auth_expired", quota: { known: false }, rateLimitResetAt: null,
    stats24h: { requests: 3, successRate: 2/3, avgLatencyMs: 15, p95LatencyMs: 20, totalTokens: 15 },
  });
});

it("throttles success writes but records failures and recovery inside the minute", async () => {
  const { createProviderConnection } = await import("@/lib/db/index.js");
  const { id } = await createProviderConnection({ provider: "example", authType: "oauth" });
  const health = async () => (await providerHealth()).find(c => c.id === id);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const snapshot = vi.spyOn(db.raw, "export");
  try {
    vi.setSystemTime(now);
    await observeConnection(id);
    vi.runAllTimers();
    expect(snapshot).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 59_999);
    await observeConnection(id);
    vi.runAllTimers();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(await health()).toMatchObject({ lastSuccessAt: date(now), state: "healthy" });
    vi.setSystemTime(now + 60_000);
    await observeConnection(id);
    expect(await health()).toMatchObject({ lastSuccessAt: date(now + 60_000) });

    for (const offset of [61_000, 62_000]) {
      vi.setSystemTime(now + offset);
      await observeConnection(id, classifyInferenceError({ refreshFailed: true }));
      expect(await health()).toMatchObject({ lastErrorAt: date(now + offset), state: "needs_reauth" });
    }
    vi.setSystemTime(now + 63_000);
    await observeConnection(id);
    expect(await health()).toMatchObject({ lastSuccessAt: date(now + 63_000), state: "healthy" });
  } finally { snapshot.mockRestore(); vi.useRealTimers(); }
});
