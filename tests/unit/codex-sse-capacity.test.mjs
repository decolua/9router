import assert from "node:assert/strict";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function sseResponse(text) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const executor = new CodexExecutor();

const capacity = await executor._peekSseTransientError(sseResponse([
  "event: error",
  'data: {"error":{"message":"Selected model is at capacity. Please try a different model."}}',
  "",
].join("\n")));

assert.equal(capacity.matched, "selected model is at capacity");
assert.equal(capacity.accountFallback, true);
assert.equal(capacity.message, "Selected model is at capacity. Please try a different model.");

const normal = await executor._peekSseTransientError(sseResponse([
  "event: response.output_text.delta",
  'data: {"delta":"OK"}',
  "",
].join("\n")));

assert.equal(normal.matched, null);
assert.ok(normal.replacementBody);

const text = await new Response(normal.replacementBody).text();
assert.match(text, /response\.output_text\.delta/);
assert.match(text, /OK/);

console.log("codex-sse-capacity ok");
