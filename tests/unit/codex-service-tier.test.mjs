import assert from "node:assert/strict";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const executor = new CodexExecutor();
const body = executor.transformRequest(
  "gpt-5.5",
  { model: "gpt-5.5", input: "hi", service_tier: "fast" },
  true,
  { connectionId: "conn_1", providerSpecificData: {} },
);

assert.equal(body.service_tier, "priority");

const unsupported = executor.transformRequest(
  "gpt-5.5",
  { model: "gpt-5.5", input: "hi", service_tier: "flex" },
  true,
  { connectionId: "conn_1", providerSpecificData: {} },
);

assert.equal(unsupported.service_tier, undefined);
console.log("codex-service-tier ok");
