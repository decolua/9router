// continuitySelfCheck.mjs
// Run: node open-sse/utils/continuitySelfCheck.mjs
// No framework. No dependencies. Bails on first failure via assertion.
import assert from "node:assert/strict";
import { stripTags, stripTaggedThinking } from "./taggedThinkingNormalizer.js";
import { extractThinking } from "./thinkingExtractor.js";
import { buildContinuityPrompt } from "../rtk/continuityPrompt.js";

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

// --- stripTags -----------------------------------------------------------
check("stripTags: removes known tag markers, keeps inner text", () => {
  assert.equal(stripTags("<think>hello</think>"), "hello");
  assert.equal(stripTags("<thinking>a</thinking><thought>b</thought>"), "ab");
  assert.equal(stripTags("<reasoning>r</reasoning><analysis>x</analysis>"), "rx");
  assert.equal(stripTags("no tags here"), null);
  assert.equal(stripTags(123), null);
});

// --- stripTaggedThinking -------------------------------------------------
check("stripTaggedThinking: OpenAI delta.content string leaf", () => {
  const obj = { choices: [{ delta: { content: "<think>hi</think>" } }] };
  assert.equal(stripTaggedThinking(obj), true);
  assert.equal(obj.choices[0].delta.content, "hi");
});

check("stripTaggedThinking: Claude delta.text + Responses top-level delta string", () => {
  const obj = {
    delta: { text: "<thinking>a</thinking>" },
    response: { type: "response.output_text.delta", delta: "<reasoning>b</reasoning>" },
  };
  assert.equal(stripTaggedThinking(obj), true);
  assert.equal(obj.delta.text, "a");
  assert.equal(obj.response.delta, "b");
});

check("stripTaggedThinking: no-op returns false", () => {
  const obj = { choices: [{ delta: { content: "clean" } }] };
  assert.equal(stripTaggedThinking(obj), false);
});

// --- extractThinking -----------------------------------------------------
check("extractThinking: OpenAI reasoning_content", () => {
  const r = { choices: [{ message: { reasoning_content: "abc" } }] };
  assert.equal(extractThinking(r), "abc");
});

check("extractThinking: Claude content[].type=thinking", () => {
  const r = { content: [{ type: "thinking", thinking: "head" }, { type: "text", text: "body" }] };
  assert.equal(extractThinking(r), "head");
});

check("extractThinking: Gemini thought part", () => {
  const r = { candidates: [{ content: { parts: [{ text: "g", thought: true }, { text: "c" }] } }] };
  assert.equal(extractThinking(r), "g");
});

check("extractThinking: Responses reasoning item", () => {
  const r = { output: [{ type: "reasoning", content: "r1" }, { type: "message", content: [{ text: "m" }] }] };
  assert.equal(extractThinking(r), "r1");
});

check("extractThinking: null on empty", () => {
  assert.equal(extractThinking({ choices: [{ message: { content: "x" } }] }), null);
});

check("extractThinking: dedupes identical reasoning across fields", () => {
  const r = { message: { reasoning_content: "dup", thinking: "dup" } };
  assert.equal(extractThinking(r), "dup");
});

// --- buildContinuityPrompt ----------------------------------------------
check("buildContinuityPrompt: null on empty", () => {
  assert.equal(buildContinuityPrompt([]), null);
  assert.equal(buildContinuityPrompt(null), null);
});

check("buildContinuityPrompt: wraps content in checkpoint markers", () => {
  const p = buildContinuityPrompt(["my-thought"]);
  assert.ok(p.includes("[HOST CONTINUATION CHECKPOINT]"));
  assert.ok(p.includes("<continuation_checkpoint>"));
  assert.ok(p.includes("my-thought"));
  assert.ok(p.includes("[HOST RESUME]"));
});

check("buildContinuityPrompt: fence length grows when thoughts contain backticks", () => {
  const short = buildContinuityPrompt(["abc"]);
  const fenceStartShort = short.match(/(`{5,})text/)[1].length;
  // 6 backticks exceed the default minimum (5), forcing fence to grow to 7
  const long = buildContinuityPrompt(["``````code``````"]);
  const fenceStartLong = long.match(/(`{5,})text/)[1].length;
  assert.ok(fenceStartLong > fenceStartShort, "fence must expand to avoid collision");
  assert.ok(fenceStartLong > 6, "fence must be longer than the longest backtick run in content");
});

// --- runner --------------------------------------------------------------
let failed = 0;
for (const { name, fn } of checks) {
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exit(1);
