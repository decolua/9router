import assert from "node:assert/strict";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { formatNanUsage } from "../../open-sse/services/usage/nan.js";

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
  start_date: "2026-09-01", end_date: "2026-09-27",
  totals: { total_tokens: 150, api_requests: 3, by_model: [
    { model: "deepseek-v4-flash", total_tokens: 100, api_requests: 2 },
    { model: "qwen3.6", total_tokens: 50, api_requests: 1 },
  ] },
  all_time: { total_tokens: 1000 },
};
const usage = formatNanUsage(report, new Date("2026-09-27T12:00:00Z"));
assert.equal(usage.quotas["deepseek-v4-flash"].total, 3000000000);
assert.equal(usage.quotas["deepseek-v4-flash"].used, 100);
assert.equal(usage.quotas["deepseek-v4-flash"].resetAt, "2026-10-01T00:00:00.000Z");
assert.equal(usage.quotas["mimo-v2.5"].used, 0);
assert.equal(usage.quotas["qwen3.6"].limitUnknown, true);
assert.equal(usage.quotas["qwen3.6"].total, null);
assert.equal(formatNanUsage(report, new Date("2026-12-31T23:59:00Z")).quotas["mimo-v2.5"].resetAt, "2027-01-01T00:00:00.000Z");
console.log("NaN provider and usage OK");
