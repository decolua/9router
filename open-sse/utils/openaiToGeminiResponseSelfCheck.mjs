import assert from "node:assert/strict";
import "../../tests/translator/registerAll.js";
import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";

function runFor(sourceFormat) {
  const state = initState(sourceFormat);
  const chunks = [
    { id: "chatcmpl_1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { reasoning_content: "think" }, finish_reason: null }] },
    { id: "chatcmpl_1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
    { id: "chatcmpl_1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] }, finish_reason: null }] },
    { id: "chatcmpl_1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8, completion_tokens_details: { reasoning_tokens: 1 } } },
  ];
  return chunks.flatMap(chunk => translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state) || []);
}

for (const sourceFormat of [FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX]) {
  const out = runFor(sourceFormat);
  assert.equal(out[0].response.candidates[0].content.parts[0].thought, true);
  assert.equal(out[0].response.candidates[0].content.parts[0].text, "think");
  assert.equal(out[1].response.candidates[0].content.parts[0].text, "answer");
  const finish = out[out.length - 1].response;
  assert.equal(finish.candidates[0].content.parts[0].functionCall.name, "lookup");
  assert.deepEqual(finish.candidates[0].content.parts[0].functionCall.args, { q: "x" });
  assert.equal(finish.usageMetadata.totalTokenCount, 8);
}

console.log("openaiToGeminiResponseSelfCheck: 3/3");
