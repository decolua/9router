import assert from "node:assert/strict";
import {
  classifyCopilotTokenExchange,
  parseCopilotRuntimeToken,
} from "../../open-sse/services/copilotStatus.js";

const meta = parseCopilotRuntimeToken("token; sku=plus_monthly_subscriber_quota; proxy-ep=proxy.individual.githubcopilot.com;");
assert.equal(meta.sku, "plus_monthly_subscriber_quota");
assert.equal(meta.tier, "pro+");
assert.equal(meta.proxyEndpoint, "proxy.individual.githubcopilot.com");

const banned = classifyCopilotTokenExchange(403, JSON.stringify({
  message: "Forbidden",
  error_details: { notification_id: "spammy_user" },
}));
assert.equal(banned.status, "banned");
assert.equal(banned.valid, false);

const invalid = classifyCopilotTokenExchange(401, JSON.stringify({ message: "Bad credentials" }));
assert.equal(invalid.status, "dead");
assert.equal(invalid.error, "token_invalid");

console.log("copilot-status ok");
