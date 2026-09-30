// Tool-call rescue self-check.
// Run: node open-sse/translator/concerns/toolCallRescueSelfCheck.mjs
// No framework, no deps. Each case is one shape a model actually emits.
import { indexDeclaredTools, rescueToolCall, rescueResponse, rescueRequest, rescueStreamedNames } from "./toolCallRescue.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${b}, got ${a}`); },
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
  deepEqual(a, b, msg) {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error(`${msg || ""} expected ${y}, got ${x}`);
  },
};

const BASH_TOOL = {
  type: "function",
  function: { name: "Bash", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
};
const READ_TOOL = {
  type: "function",
  function: { name: "Read", parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
};
const indexOf = (...tools) => indexDeclaredTools(tools);

function argsOfCall(call) { return JSON.parse(call.function.arguments); }

// --- the two reported faults ---

run("REPORT: bash is rewritten to the declared Bash", () => {
  const call = { id: "t1", function: { name: "bash", arguments: '{"command":"ls -la"}' } };
  const out = rescueToolCall(call, indexOf(BASH_TOOL));
  assert.equal(out.call.function.name, "Bash", "name raised back to the declared case");
  assert.ok(out.renamed, "rename reported");
  assert.equal(argsOfCall(out.call).command, "ls -la", "args untouched");
});

run("REPORT: empty args for Bash is dropped, not sent as {}", () => {
  // This is the exact shape behind `must have required property 'command'`.
  const call = { id: "t1", function: { name: "Bash", arguments: "{}" } };
  const out = rescueToolCall(call, indexOf(BASH_TOOL));
  assert.equal(out.call, null, "unrecoverable call is dropped");
  assert.deepEqual(out.unresolved, ["command"], "reports the missing property");
});

run("REPORT: a bare command string becomes the command property", () => {
  const call = { id: "t1", function: { name: "Bash", arguments: "ls -la /tmp" } };
  const out = rescueToolCall(call, indexOf(BASH_TOOL));
  assert.equal(out.call.function.name, "Bash", "name kept");
  assert.equal(argsOfCall(out.call).command, "ls -la /tmp", "bare string lifted into command");
});

run("REPORT: cmd is read as command", () => {
  const call = { id: "t1", function: { name: "Bash", arguments: '{"cmd":"pwd"}' } };
  const out = rescueToolCall(call, indexOf(BASH_TOOL));
  assert.equal(argsOfCall(out.call).command, "pwd", "alias lifted");
  assert.equal(argsOfCall(out.call).cmd, undefined, "donor key removed");
});

run("REPORT: commandLine is read as command", () => {
  const call = { id: "t1", function: { name: "Bash", arguments: '{"commandLine":"whoami"}' } };
  const out = rescueToolCall(call, indexOf(BASH_TOOL));
  assert.equal(argsOfCall(out.call).command, "whoami", "spelling variant lifted");
});

// --- name resolution ---

run("an exact name is not reported as renamed", () => {
  const out = rescueToolCall({ id: "t", function: { name: "Bash", arguments: '{"command":"ls"}' } }, indexOf(BASH_TOOL));
  assert.equal(out.renamed, false, "no rename on an exact match");
});

run("an undeclared name is left alone", () => {
  const out = rescueToolCall({ id: "t", function: { name: "Unknown", arguments: '{"a":1}' } }, indexOf(BASH_TOOL));
  assert.equal(out.call.function.name, "Unknown", "unknown name preserved");
  assert.equal(out.renamed, false, "no rename claimed");
});

run("the first declaration wins a case duplicate", () => {
  const other = { type: "function", function: { name: "bash", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } } };
  const out = rescueToolCall({ id: "t", function: { name: "BASH", arguments: '{"command":"ls"}' } }, indexOf(BASH_TOOL, other));
  assert.equal(out.call.function.name, "Bash", "first declared name wins");
});

run("no tools declared means the call is untouched", () => {
  const call = { id: "t", function: { name: "Bash", arguments: "{}" } };
  const out = rescueToolCall(call, indexOf());
  assert.equal(out.call, call, "call returned by identity");
});

// --- what must never be broken ---

run("a well formed call is byte-identical", () => {
  const call = { id: "t", function: { name: "Bash", arguments: '{"command":"ls"}' } };
  const out = rescueToolCall(call, indexOf(BASH_TOOL));
  assert.equal(out.call.function.arguments, '{"command":"ls"}', "no reformat of a good call");
  assert.equal(out.recovered, 0, "nothing recovered");
  assert.equal(out.renamed, false, "nothing renamed");
});

run("a bare string is not lifted into a two-property tool", () => {
  const both = {
    type: "function",
    function: { name: "Edit", parameters: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" } }, required: ["old_string", "new_string"] } },
  };
  const out = rescueToolCall({ id: "t", function: { name: "Edit", arguments: "some text" } }, indexOf(both));
  assert.equal(out.call, null, "ambiguous bare string is dropped, not guessed");
  assert.equal(out.unresolved.length, 2, "both properties unresolved");
});

run("oldString is read as old_string", () => {
  const both = {
    type: "function",
    function: { name: "Edit", parameters: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" } }, required: ["old_string", "new_string"] } },
  };
  const call = { id: "t", function: { name: "Edit", arguments: '{"oldString":"a","newString":"b"}' } };
  const out = rescueToolCall(call, indexOf(both));
  assert.equal(argsOfCall(out.call).old_string, "a", "camel donor lifted");
  assert.equal(argsOfCall(out.call).new_string, "b", "second donor lifted");
});

run("a schema default fills the property", () => {
  const tool = {
    type: "function",
    function: { name: "Wait", parameters: { type: "object", properties: { ms: { type: "number", default: 1000 } }, required: ["ms"] } },
  };
  const out = rescueToolCall({ id: "t", function: { name: "Wait", arguments: "{}" } }, indexOf(tool));
  assert.equal(argsOfCall(out.call).ms, 1000, "default applied");
});

run("a schema without required leaves a call alone", () => {
  const tool = { type: "function", function: { name: "Note", parameters: { type: "object", properties: { text: { type: "string" } } } } };
  const out = rescueToolCall({ id: "t", function: { name: "Note", arguments: "{}" } }, indexOf(tool));
  assert.ok(out.call, "not dropped when nothing is required");
});

run("a non-object arguments value does not throw", () => {
  for (const raw of [null, undefined, 42, true, [], "null", "[]"]) {
    const out = rescueToolCall({ id: "t", function: { name: "Bash", arguments: raw } }, indexOf(BASH_TOOL));
    assert.ok(out.call === null || typeof out.call === "object", `survived ${JSON.stringify(raw)}`);
  }
});

run("a call with no name is returned untouched", () => {
  const call = { id: "t", function: { arguments: "{}" } };
  assert.equal(rescueToolCall(call, indexOf(BASH_TOOL)).call, call, "identity kept");
  assert.equal(rescueToolCall(null, indexOf(BASH_TOOL)).call, null, "null safe");
});

// --- response path ---

run("response: the reported failure is stopped before the client sees it", () => {
  const payload = {
    choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [
      { id: "a", type: "function", function: { name: "bash", arguments: "{}" } },
    ] }, finish_reason: "tool_calls" }],
  };
  const { payload: out, dropped, renamed } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(dropped, 1, "one call dropped");
  assert.equal(renamed, 0, "name is moot once dropped");
  assert.equal(out.choices[0].message.tool_calls, undefined, "empty tool_calls removed");
  assert.equal(out.choices[0].finish_reason, "stop", "finish_reason corrected");
  assert.equal(out.choices[0].message.content, "", "content filled so the turn is still valid");
});

run("response: a renamed call reaches the client with the declared name", () => {
  const payload = {
    choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [
      { id: "a", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
    ] }, finish_reason: "tool_calls" }],
  };
  const { payload: out, renamed } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(renamed, 1, "rename counted");
  assert.equal(out.choices[0].message.tool_calls[0].function.name, "Bash", "declared case applied");
  assert.equal(out.choices[0].finish_reason, "tool_calls", "finish_reason untouched on a good call");
});

run("response: a rescued call is not counted as renamed", () => {
  const payload = {
    choices: [{ index: 0, message: { role: "assistant", tool_calls: [
      { id: "a", type: "function", function: { name: "Bash", arguments: '{"cmd":"ls"}' } },
    ] }, finish_reason: "tool_calls" }],
  };
  const { payload: out, recovered, renamed } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(recovered, 1, "recovery counted");
  assert.equal(renamed, 0, "no rename on an exact name");
  assert.equal(JSON.parse(out.choices[0].message.tool_calls[0].function.arguments).command, "ls", "recovered value");
});

run("response: one good call survives beside one dropped call", () => {
  const payload = {
    choices: [{ index: 0, message: { role: "assistant", tool_calls: [
      { id: "a", type: "function", function: { name: "Bash", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "Read", arguments: '{"file_path":"/etc/hosts"}' } },
    ] }, finish_reason: "tool_calls" }],
  };
  const { payload: out, dropped } = rescueResponse(payload, [BASH_TOOL, READ_TOOL]);
  assert.equal(dropped, 1, "only the unrecoverable one dropped");
  assert.equal(out.choices[0].message.tool_calls.length, 1, "the good call stays");
  assert.equal(out.choices[0].message.tool_calls[0].id, "b", "surviving id");
  assert.equal(out.choices[0].finish_reason, "tool_calls", "still a tool turn");
});

run("response: a payload with no tools declared is returned as-is", () => {
  const payload = { choices: [{ message: { tool_calls: [{ id: "a", function: { name: "Bash", arguments: "{}" } }] } }] };
  const { payload: out, dropped } = rescueResponse(payload, []);
  assert.equal(out, payload, "identity kept");
  assert.equal(dropped, 0, "nothing dropped");
});

run("response: null and non-object payloads do not throw", () => {
  for (const p of [null, undefined, 42, "x", []]) {
    assert.ok(rescueResponse(p, [BASH_TOOL]).payload === p, `survived ${JSON.stringify(p)}`);
  }
});

run("response: a choice with no tool_calls is untouched", () => {
  const payload = { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] };
  const { payload: out } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(out.choices[0].message.content, "hi", "content intact");
  assert.equal(out.choices[0].message.tool_calls, undefined, "none invented");
});

run("response: Claude tool_use blocks are rescued", () => {
  const payload = {
    type: "message",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }],
  };
  const { payload: out, dropped } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(dropped, 1, "unrecoverable tool_use dropped");
  assert.equal(out.content.some((b) => b?.type === "tool_use"), false, "block removed");
  assert.equal(out.stop_reason, "end_turn", "stop_reason corrected so the turn is well formed");
  assert.equal(out.content[0].type, "text", "an empty text block takes its place");
});

run("response: a recoverable Claude block keeps its identity", () => {
  const payload = {
    type: "message",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "bash", input: { cmd: "ls" } }],
  };
  const { payload: out, renamed, recovered, dropped } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(dropped, 0, "nothing dropped");
  assert.equal(renamed, 1, "rename counted");
  assert.equal(recovered, 1, "recovery counted");
  assert.equal(out.content[0].id, "t1", "id preserved");
  assert.equal(out.content[0].name, "Bash", "declared case applied");
  assert.equal(out.content[0].input.command, "ls", "recovered input");
  assert.equal(out.stop_reason, "tool_use", "still a tool turn");
});

run("response: Responses function_call items are rescued", () => {
  const payload = {
    object: "response",
    output: [{ type: "function_call", call_id: "c1", name: "bash", arguments: '{"command":"ls"}' }],
  };
  const { payload: out, renamed } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(renamed, 1, "rename counted");
  assert.equal(out.output[0].name, "Bash", "declared case applied");
});

run("response: an unrecoverable Responses item leaves no _dropped marker", () => {
  const payload = { object: "response", output: [{ type: "function_call", call_id: "c1", name: "Bash", arguments: "{}" }] };
  const { payload: out, dropped } = rescueResponse(payload, [BASH_TOOL]);
  assert.equal(dropped, 1, "dropped counted");
  assert.equal(out.output.length, 0, "item removed");
  assert.equal(out.output.some((i) => "_dropped" in i), false, "no internal marker leaks");
});

// --- request path ---

run("request: the rejected call in the history is rescued", () => {
  const body = {
    tools: [BASH_TOOL],
    messages: [
      { role: "user", content: "ls please" },
      { role: "assistant", content: null, tool_calls: [{ id: "a", function: { name: "bash", arguments: "{}" } }] },
    ],
  };
  const { body: out, dropped } = rescueRequest(body);
  assert.equal(dropped, 1, "the broken call leaves the history");
  assert.equal(out.messages[1].tool_calls, undefined, "tool_calls removed");
  assert.equal(out.messages[0].content, "ls please", "surrounding history intact");
});

run("request: the rename persists so the next turn is stable", () => {
  const body = {
    tools: [BASH_TOOL],
    messages: [{ role: "assistant", content: null, tool_calls: [{ id: "a", function: { name: "bash", arguments: '{"command":"ls"}' } }] }],
  };
  const { body: out, renamed } = rescueRequest(body);
  assert.equal(renamed, 1, "rename counted");
  assert.equal(out.messages[0].tool_calls[0].function.name, "Bash", "stored under the declared name");
});

run("request: a body with no tools declared is returned as-is", () => {
  const body = { messages: [{ role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: "{}" } }] }] };
  const { body: out, dropped } = rescueRequest(body);
  assert.equal(out, body, "identity kept");
  assert.equal(dropped, 0, "nothing dropped without a schema to check against");
});

run("request: null does not throw", () => {
  assert.equal(rescueRequest(null).body, null, "null safe");
  assert.equal(rescueRequest(undefined).body, undefined, "undefined safe");
});

// --- streaming: the name only, never the arguments ---

run("stream: a wrong-case name is raised as the first delta arrives", () => {
  // The exact OpenAI first delta: name whole, arguments still an empty string.
  const chunk = {
    choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: "" } }] } }],
  };
  const fixed = rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL]));
  assert.equal(fixed, 1, "one name corrected");
  assert.equal(chunk.choices[0].delta.tool_calls[0].function.name, "Bash", "declared case applied");
  assert.equal(chunk.choices[0].delta.tool_calls[0].function.arguments, "", "arguments untouched");
  assert.equal(chunk.choices[0].delta.tool_calls[0].id, "call_1", "id untouched");
});

run("stream: argument fragments are never buffered or rewritten", () => {
  // A name fix that also touched arguments would have to reassemble the
  // fragments, which is exactly the latency the streaming path cannot spend.
  const chunk = {
    choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "bash", arguments: '{"comm' } }] } }],
  };
  rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL]));
  assert.equal(chunk.choices[0].delta.tool_calls[0].function.arguments, '{"comm', "fragment passed through as-is");
  assert.equal(chunk.choices[0].delta.tool_calls[0].function.name, "Bash", "name still fixed");
});

run("stream: every delta of a call gets the fix, not just the first", () => {
  const index = indexDeclaredTools([BASH_TOOL]);
  const first = { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "bash", arguments: "" } }] } }] };
  const second = { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] } }] };
  assert.equal(rescueStreamedNames(first, index), 1, "first delta fixed");
  assert.equal(rescueStreamedNames(second, index), 0, "later fragment needs no fix");
});

run("stream: a Claude content_block_start is corrected", () => {
  const chunk = { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "bash", input: {} } };
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL])), 1, "name corrected");
  assert.equal(chunk.content_block.name, "Bash", "declared case applied");
  assert.equal(chunk.type, "content_block_start", "event type untouched");
});

run("stream: a Responses output_item.added is corrected", () => {
  const chunk = { type: "response.output_item.added", output_index: 0, item: { type: "function_call", call_id: "c1", name: "bash", arguments: "" } };
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL])), 1, "name corrected");
  assert.equal(chunk.item.name, "Bash", "declared case applied");
  assert.equal(chunk.item.type, "function_call", "item type untouched");
});

run("stream: a text chunk is never touched", () => {
  const chunk = { choices: [{ delta: { content: "hello bash" } }] };
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL])), 0, "nothing corrected");
  assert.equal(chunk.choices[0].delta.content, "hello bash", "content intact");
});

run("stream: a name that is not a declared tool is left alone", () => {
  const chunk = { choices: [{ delta: { tool_calls: [{ function: { name: "TotallyOther", arguments: "{}" } }] } }] };
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL])), 0, "nothing corrected");
  assert.equal(chunk.choices[0].delta.tool_calls[0].function.name, "TotallyOther", "name intact");
});

run("stream: an exact name is not rewritten", () => {
  const chunk = { choices: [{ delta: { tool_calls: [{ function: { name: "Bash", arguments: "" } }] } }] };
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL])), 0, "no needless rewrite");
});

run("stream: no declared tools means the walk is skipped entirely", () => {
  const chunk = { choices: [{ delta: { tool_calls: [{ function: { name: "bash" } }] } }] };
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([])), 0, "empty index short-circuits");
  assert.equal(chunk.choices[0].delta.tool_calls[0].function.name, "bash", "name left as the model wrote it");
});

run("stream: null and non-object chunks do not throw", () => {
  const index = indexDeclaredTools([BASH_TOOL]);
  for (const c of [null, undefined, 42, "x", true]) {
    assert.equal(rescueStreamedNames(c, index), 0, `survived ${JSON.stringify(c)}`);
  }
  assert.equal(rescueStreamedNames({ choices: [] }, null), 0, "no index");
});

run("stream: a top-level array of chunks is walked", () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ function: { name: "bash" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { name: "read" } }] } }] },
  ];
  const fixed = rescueStreamedNames(chunks, indexDeclaredTools([BASH_TOOL, READ_TOOL]));
  assert.equal(fixed, 2, "both chunks corrected");
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].function.name, "Bash", "first corrected");
  assert.equal(chunks[1].choices[0].delta.tool_calls[0].function.name, "Read", "second corrected");
});

run("stream: a circular chunk does not hang the walk", () => {
  const chunk = { choices: [{ delta: { tool_calls: [{ function: { name: "bash" } }] } }] };
  chunk.self = chunk;
  assert.equal(rescueStreamedNames(chunk, indexDeclaredTools([BASH_TOOL])), 1, "fixed before recursing further");
});

// --- structural guard on the stream wiring ---

// The helper above is only reachable if the stream actually calls it, and every
// case above passed with the call site removed. A pure-function check cannot
// see a missing hook, so the emit sites are counted in the source instead.
run("every translated chunk the stream emits passes through the name rescue", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../utils/stream.js"),
    "utf8",
  );
  assert.ok(src.includes("indexDeclaredTools(body?.tools)"), "the declared tools are not indexed");
  assert.ok(src.includes("const fixStreamedToolNames ="), "no rescue wrapper");

  // Total emits, so a new emit site forces a decision rather than slipping past.
  const emits = (src.match(/controller\.enqueue\(sharedEncoder\.encode\(output\)\)/g) || []).length;
  assert.equal(emits, 6, `emit sites changed to ${emits}; decide whether the new one needs the guard`);

  // Two of the six enqueue a raw upstream SSE line rather than a translated
  // object, so there is nothing parsed to correct without re-parsing the line.
  // They are passthrough, where the CLI tool and the provider are the same
  // ecosystem and the model sees the names the client declared. The other four
  // are guarded, and this count is what makes a regression there visible.
  const fixes = (src.match(/fixStreamedToolNames\((parsed|item)\)/g) || []).length;
  assert.equal(fixes, 5, `expected 5 guarded sites, found ${fixes}`);
});

run("the stream rescue never rewrites streamed arguments", () => {
  // A name fix that also rewrote arguments would have to reassemble fragments,
  // holding back every tool call in the stream.
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../utils/stream.js"),
    "utf8",
  );
  assert.ok(!src.includes("toolSchemas"), "streaming re-introduced a schema buffer");
  assert.ok(!src.includes("repairToolCallsInNode"), "streaming re-introduced in-flight repair");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
