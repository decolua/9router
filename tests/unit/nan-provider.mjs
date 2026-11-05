import assert from "node:assert/strict";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { formatNanUsage } from "../../open-sse/services/usage/nan.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

assert.equal(new Set(REGISTRY.map((item) => item.id)).size, REGISTRY.length, "provider IDs must be unique");
for (const id of ["nan", "tinyfish", "v1m", "muse", "minimax-code", "minimax-code-global", "bedrock", "bedrock-xai", "sensenova", "deepseek-web", "gemini-web", "muse-web", "chatgpt-web", "veoaifree-web", "uc-web"]) {
  assert.equal(REGISTRY.filter((item) => item.id === id).length, 1, `${id} must be registered once`);
}
for (const id of ["trae", "devin-cli", "windsurf"]) {
  assert.equal(REGISTRY.some((item) => item.id === id), false, `${id} must remain disabled`);
}
const nan = REGISTRY.find((item) => item.id === "nan");
assert(nan);
assert.equal(nan.models.find((item) => item.id === "rerank").kind, "rerank");
assert.equal(nan.models.find((item) => item.id === "flux-2-klein").kind, "image");
assert.equal(nan.imageConfig.editUrl, "https://api.nan.builders/v1/images/edits");
assert.equal(getCapabilitiesForModel("nan", "mimo-v2.5").audioInput, true);
assert.equal(getCapabilitiesForModel("nan", "glm5.3-flash").vision, true);
assert.equal(getCapabilitiesForModel("nan", "glm5.3").vision, false);
const retry = await parseUpstreamError(new Response('{"error":{"message":"slow down"}}', {
  status: 429, headers: { "retry-after": "60" },
}));
assert(retry.resetsAtMs > Date.now() + 59000 && retry.resetsAtMs < Date.now() + 61000);
const report = {
  periodStart: "2026-10-01",
  models: [
    { model: "deepseek-v4-flash", tokensUsed: 1500000000, cap: 3000000000, periodEnd: "2026-11-01T00:00:00Z" },
    { model: "glm5.3-flash", tokensUsed: 650000000, cap: 2000000000, periodEnd: "2026-11-01T00:00:00Z" },
    { model: "glm5.3", tokensUsed: 500000000, cap: 1500000000, fullCap: 3000000000, periodEnd: "2026-11-09T15:06:22Z" },
  ],
};
const usage = formatNanUsage(report);
assert.equal(usage.plan, "NaN");
assert.deepEqual(Object.keys(usage.quotas), report.models.map((row) => row.model));
for (const row of report.models) {
  assert.deepEqual(usage.quotas[row.model], {
    used: row.tokensUsed, total: row.cap, resetAt: row.periodEnd, unit: "tokens",
  });
}
assert.equal(usage.summary, undefined);
assert.equal(nan.transport.usage.url, "https://cloud-api.nan.builders/api/usage/quota");
assert.equal(nan.transport.usage.monthlyTokenCaps, undefined);

for (const used of [0, 100, 101]) {
  const result = formatNanUsage({ models: [{ model: "new-model", tokensUsed: used, cap: 100 }] });
  assert.deepEqual(result.quotas["new-model"], { used, total: 100, resetAt: null, unit: "tokens" });
}
for (const invalid of [
  null, {}, { models: [] }, { models: {} }, { models: [null] },
  { totals: { total_tokens: 0, api_requests: 0, by_model: [] }, all_time: { total_tokens: 0 } },
  ...[
    { model: "" }, { model: " " }, { model: 1 },
    { tokensUsed: undefined }, { tokensUsed: null }, { tokensUsed: -1 }, { tokensUsed: "0" },
    { tokensUsed: 0.5 }, { tokensUsed: Infinity }, { tokensUsed: Number.MAX_SAFE_INTEGER + 1 },
    { cap: undefined }, { cap: null }, { cap: 0 }, { cap: -1 }, { cap: "100" },
    { cap: 0.5 }, { cap: Infinity }, { periodEnd: "invalid-date" }, { periodEnd: 123 },
  ].map((overrides) => ({ models: [report.models[0], { ...report.models[1], ...overrides }] })),
  { models: [report.models[0], report.models[0]] },
]) {
  const result = formatNanUsage(invalid);
  assert.equal(result.quotas, undefined);
  assert.match(result.message, /unavailable/i);
}
const nanExec = new DefaultExecutor("nan");
const msgs = [{ role: "user", content: "hi" }];
assert.deepEqual(nanExec.transformRequest("gemma4", { messages: msgs, stream: true }, true, {}).stream_options, { include_usage: true });
assert.equal(nanExec.transformRequest("gemma4", { messages: msgs }, false, {}).stream_options, undefined);
assert.deepEqual(nanExec.transformRequest("gemma4", { messages: msgs, stream_options: { include_usage: false } }, true, {}).stream_options, { include_usage: false });
console.log("NaN provider and usage OK");
