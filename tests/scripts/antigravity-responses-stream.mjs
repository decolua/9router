import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Resolve the app alias without starting Next.js or opening the database.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith("@/")
      ? new URL(`../../src/${specifier.slice(2)}`, import.meta.url).href
      : specifier, context);
  },
});

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { initState, translateResponse } = await import("../../open-sse/translator/index.js");

function checkEvents(events, types) {
  const added = events.filter(({ event }) => event === "response.output_item.added");
  assert.deepEqual(added.map(({ data }) => data.output_index), types.map((_, i) => i));
  assert.deepEqual(added.map(({ data }) => data.item.type), types);
  const indices = new Map(added.map(({ data }) => [data.item.id, data.output_index]));
  for (const { data } of events) {
    if (data.output_index !== undefined) {
      assert.equal(data.output_index, indices.get(data.item?.id || data.item_id));
    }
  }
  const completed = events.filter(({ event }) => event === "response.completed");
  assert.equal(completed.length, 1);
  assert.equal(events.at(-1).event, "response.completed");
  assert.deepEqual(completed[0].data.response.output.map((item) => item.id), [...indices.keys()]);
  for (const { data } of events.filter(({ event }) => event === "response.output_item.done")) {
    assert.deepEqual(completed[0].data.response.output[data.output_index], data.item);
  }
  assert.deepEqual(events.map(({ data }) => data.sequence_number), events.map((_, i) => i + 1));
}

for (const target of [FORMATS.ANTIGRAVITY, FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX]) {
  for (const finish of [false, true]) {
    const state = { ...initState(FORMATS.OPENAI_RESPONSES), targetFormat: target };
    const chunks = [
      { response: { candidates: [{ content: { parts: [{ thought: true, text: "Thinking" }] } }] } },
      { response: { candidates: [{ content: { parts: [{ text: "Checking " }] } }] } },
      { response: { candidates: [{ content: { parts: [{ text: "the files." }] } }] } },
      { response: { candidates: [{ content: { parts: [
        { functionCall: { id: "call_shell", name: "shell", args: { command: "pwd" } } },
        { functionCall: { id: "call_list", name: "list", args: {} } },
      ] } }] } },
    ];
    if (finish) chunks.push({ response: { candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } } });
    chunks.push(null);
    const events = chunks.flatMap((chunk) => translateResponse(target, FORMATS.OPENAI_RESPONSES, chunk, state));
    checkEvents(events, ["reasoning", "message", "function_call", "function_call"]);
    assert.equal(events.at(-1).data.response.output[1].content[0].text, "Checking the files.");
    assert.deepEqual(translateResponse(target, FORMATS.OPENAI_RESPONSES, null, state), []);
  }
}

// Chat tool indices and choice indices are separate namespaces, not output positions.
const state = { ...initState(FORMATS.OPENAI_RESPONSES), targetFormat: FORMATS.OPENAI, customToolNames: new Set(["exec"]) };
const events = [
  { choices: [{ index: 4, delta: { content: "Running tools." } }] },
  { choices: [{ index: 4, delta: { tool_calls: [{ index: 7, id: "call_exec", function: { name: "exec", arguments: '{"input":"return 1;"}' } }] } }] },
  { choices: [{ index: 4, delta: { tool_calls: [{ index: 2, id: "call_shell", function: { name: "shell", arguments: '{"command":' } }] } }] },
  { choices: [{ index: 4, delta: { tool_calls: [{ index: 2, function: { arguments: '"pwd"}' } }] } }] },
  null,
].flatMap((chunk) => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state));
checkEvents(events, ["message", "custom_tool_call", "function_call"]);
assert.equal(events.at(-1).data.response.output[1].input, "return 1;");
assert.equal(events.at(-1).data.response.output[2].arguments, '{"command":"pwd"}');
console.log("Antigravity Responses stream checks passed.");