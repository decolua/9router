import assert from "node:assert/strict";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const executor = new CodexExecutor();

const topLevel = executor.transformRequest(
  "gpt-5.5",
  { model: "gpt-5.5", input: "hi", reasoning_effort: "max" },
  true,
  { connectionId: "conn_1", providerSpecificData: {} },
);

assert.equal(topLevel.reasoning.effort, "xhigh");

const nested = executor.transformRequest(
  "gpt-5.5",
  { model: "gpt-5.5", input: "hi", reasoning: { effort: "max" } },
  true,
  { connectionId: "conn_1", providerSpecificData: {} },
);

assert.equal(nested.reasoning.effort, "xhigh");
assert.equal(nested.reasoning.summary, "auto");
console.log("codex-reasoning-effort ok");
