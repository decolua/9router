import assert from "node:assert/strict";
import { mock } from "node:test";

// Run: node --experimental-test-module-mocks tests/unit/openrouter-usage-check.mjs

let body = { data: { effective_budget: { scope: "member", limit_usd: 50, spend_usd: 40 }, free_model_daily_requests: { used: 2, limit: 50 } } };
let status = 200;
let creditsStatus = 200;
let credits = { total_credits: 100, total_usage: 25 };
mock.module("../../open-sse/utils/proxyFetch.js", { namedExports: { proxyAwareFetch: async (url, options) => {
  assert.equal(options.headers.Authorization, "Bearer test-key");
  if (url === "https://openrouter.ai/api/v1/credits") return Response.json({ data: credits }, { status: creditsStatus });
  assert.equal(url, "https://openrouter.ai/api/v1/key");
  return new Response(JSON.stringify(body), { status });
} } });
const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
const connection = { provider: "openrouter", apiKey: "test-key" };
let result = await getUsageForProvider(connection);
assert.equal(result.quotas["Budget 1 (member)"].used, 40);
assert.equal(result.quotas["Account credit balance"].total, 75);
assert.equal(result.quotas["Free models daily (tier policy)"].total, 50);
body = { data: { limit: 0, limit_remaining: 0 } };
result = await getUsageForProvider(connection);
assert.equal(result.quotas["Key spending limit"].total, 0);
body = { data: { limit: null, limit_remaining: null } };
creditsStatus = 403;
result = await getUsageForProvider(connection);
assert.equal(result.quotas["Account credit balance"].emptyMessage, "Requires management key");
body = { data: { budgets: [{ scope: "member", limit_usd: 10, spend_usd: 3 }, { scope: "workspace", limit_usd: 20, spend_usd: 5 }] } };
result = await getUsageForProvider(connection);
assert.equal(result.quotas["Budget 2 (workspace)"].used, 5);
status = 401;
assert.match((await getUsageForProvider(connection)).message, /401/);
assert.match((await getUsageForProvider({ provider: "openrouter" })).message, /key/i);