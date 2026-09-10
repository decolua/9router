import assert from "node:assert/strict";
import "../../tests/translator/registerAll.js";
import { initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";

const state = initState(FORMATS.OPENAI_RESPONSES);
assert.ok(state.responseId, "fixture: responseId pre-set by initState");

const toolCallChunk = '{"type":"tool-call","toolCallId":"call_a","toolName":"Read","input":{"path":"x"}}';
const out = commandCodeToOpenAIResponse(toolCallChunk, state);
assert.ok(Array.isArray(out) && out.length > 0, "tool-call emits a chunk");
assert.equal(out[0].choices[0].delta.tool_calls[0].id, "call_a");

const second = commandCodeToOpenAIResponse(toolCallChunk, state);
assert.equal(second, null);

const tc2 = '{"type":"tool-call","toolCallId":"call_b","toolName":"Grep","input":{"pattern":"y"}}';
const out2 = commandCodeToOpenAIResponse(tc2, state);
assert.equal(out2[0].choices[0].delta.tool_calls[0].index, 1, "second tool call gets index 1");

const textChunk = '{"type":"text-delta","text":"hello"}';
const out3 = commandCodeToOpenAIResponse(textChunk, state);
assert.equal(out3[0].choices[0].delta.content, "hello");

console.log("commandcodeIdempotentStateSelfCheck: 4/4");
