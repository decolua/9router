// F27 / RM9 — applyJsonSchemaFallback must not mutate the shared request body.
//
// Findings docs/orchestration/findings/T1.1.md §M9:
// `messages.map(m => ({ ...m }))` is a shallow copy — when the system message's
// `content` is an ARRAY, `sys.content.push(...)` mutates the CALLER's array.
// base.js calls transformRequest again on every retry iteration (502 → up to 3
// retries per URL) and chatCore reuses the same translatedBody after a 401
// refresh → the JSON-schema prompt accumulates per attempt ("prompt duplicated
// in 2nd attempt: 2"), inflating payload and degrading schema compliance with
// contradictory "Respond ONLY with the JSON object" blocks.
//
// Fix contract: pure function — input body deep-untouched, N calls with the
// same input produce identical outputs (no accumulation), returned body has
// json_schema downgraded to json_object with the prompt appended exactly once.

import { describe, it, expect } from "vitest";

const { DefaultExecutor } = await import("../../open-sse/executors/default.js");

const ex = new DefaultExecutor("openai-compatible-f27test");

function makeBody() {
  return {
    model: "m",
    messages: [
      { role: "system", content: [{ type: "text", text: "You are terse." }] },
      { role: "user", content: "hi" },
    ],
    response_format: { type: "json_schema", json_schema: { name: "ans", schema: { type: "object" } } },
  };
}

describe("applyJsonSchemaFallback purity (shared-body accumulation)", () => {
  it("calling it twice on the SAME body leaves the caller's content array untouched", () => {
    const body = makeBody();
    const sysContent = body.messages[0].content;
    const snapshot = JSON.stringify(body);

    ex.applyJsonSchemaFallback(body);
    expect(sysContent).toHaveLength(1); // RED: 2 — push() mutated the caller's array
    ex.applyJsonSchemaFallback(body);
    expect(sysContent).toHaveLength(1); // RED: 3 — prompt accumulates per retry
    expect(JSON.stringify(body)).toBe(snapshot);
    // the ORIGINAL body still asks for json_schema (fallback applied to the copy only)
    expect(body.response_format.type).toBe("json_schema");
  });

  it("outputs of call #1 and call #2 are identical (no accumulation across retries)", () => {
    const body = makeBody();
    const out1 = ex.applyJsonSchemaFallback(body);
    const out2 = ex.applyJsonSchemaFallback(body);

    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2)); // RED: out2 carries the prompt twice
    const texts1 = out1.messages[0].content.map((b) => b.text).join("|");
    const schemaPromptCount = (texts1.match(/Respond ONLY with the JSON object/g) || []).length;
    expect(schemaPromptCount).toBe(1);
    expect(out1.response_format).toEqual({ type: "json_object" });
  });

  it("string system content branch stays non-mutating and prompt-doubling-free", () => {
    const body = {
      model: "m",
      messages: [{ role: "system", content: "base" }],
      response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
    };
    const out1 = ex.applyJsonSchemaFallback(body);
    const out2 = ex.applyJsonSchemaFallback(body);
    expect(body.messages[0].content).toBe("base");
    expect(out1.messages[0].content).toBe(out2.messages[0].content);
    expect(out1.messages[0].content.match(/Respond ONLY/g)).toHaveLength(1);
  });

  it("no system message: unshift goes to the copy, caller's messages array untouched", () => {
    const body = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
    };
    const out = ex.applyJsonSchemaFallback(body);
    expect(body.messages).toHaveLength(1); // pin: unshift must never hit the caller's array
    expect(out.messages[0].role).toBe("system");
  });

  it("non openai-compatible provider: passthrough of the very same object", () => {
    const other = new DefaultExecutor("claude");
    const body = makeBody();
    expect(other.applyJsonSchemaFallback(body)).toBe(body);
  });
});
