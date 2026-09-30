// Tool-call fallback self-check.
// Run: node open-sse/translator/concerns/toolCallFallbackSelfCheck.mjs
// No framework, no deps. Uses assert. Mirrors claudeToolTypeSelfCheck.mjs style.
import { repair, degrade, isToolCallRejection, TOOL_FALLBACK_MAX_LEVEL } from "./toolCallFallback.js";

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

// --- repair: malformed tool arguments ---

run("empty string arguments become {}", () => {
  const body = { messages: [{ role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: "" } }] }] };
  repair(body);
  assert.equal(body.messages[0].tool_calls[0].function.arguments, "{}", "empty args normalised");
});

run("truncated JSON arguments are closed back up", () => {
  const body = { messages: [{ role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: '{"command":"ls' } }] }] };
  repair(body);
  const parsed = JSON.parse(body.messages[0].tool_calls[0].function.arguments);
  assert.equal(parsed.command, "ls", "truncated object closed");
});

run("object arguments are stringified", () => {
  const body = { messages: [{ role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: { command: "ls" } } }] }] };
  repair(body);
  assert.equal(body.messages[0].tool_calls[0].function.arguments, '{"command":"ls"}', "object stringified");
});

run("valid arguments pass through unchanged", () => {
  const body = { messages: [{ role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: '{"command":"ls"}' } }] }] };
  repair(body);
  assert.equal(body.messages[0].tool_calls[0].function.arguments, '{"command":"ls"}', "valid args kept");
});

run("tool_calls without a function name are dropped", () => {
  const body = { messages: [{ role: "assistant", tool_calls: [{ id: "a", function: {} }] }] };
  repair(body);
  assert.equal(body.messages[0].tool_calls.length, 0, "nameless call dropped");
});

// --- repair: orphaned tool results ---

run("tool result with a matching id is kept", () => {
  const body = {
    messages: [
      { role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "ok" },
    ],
  };
  repair(body);
  assert.equal(body.messages.length, 2, "paired result kept");
});

run("orphaned tool result is dropped", () => {
  const body = {
    messages: [
      { role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "stale", content: "ok" },
    ],
  };
  repair(body);
  assert.equal(body.messages.length, 1, "orphan dropped");
});

run("orphaned Claude tool_result block is dropped", () => {
  const body = {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "gone", content: "ok" }] },
    ],
  };
  repair(body);
  assert.equal(body.messages[1].content.length, 0, "orphan block dropped");
});

run("Responses function_call_output with a matching call_id is kept", () => {
  const body = {
    input: [
      { type: "function_call", call_id: "c1", name: "Bash", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ],
  };
  repair(body);
  assert.equal(body.input.length, 2, "paired output kept");
});

run("Responses orphan function_call_output is dropped", () => {
  const body = {
    input: [
      { type: "function_call", call_id: "c1", name: "Bash", arguments: "{}" },
      { type: "function_call_output", call_id: "gone", output: "ok" },
    ],
  };
  repair(body);
  assert.equal(body.input.length, 1, "orphan dropped");
});

// --- repair: tool_choice ---

run("tool_choice naming an unknown tool is removed", () => {
  const body = { tools: [{ type: "function", function: { name: "Read" } }], tool_choice: { type: "tool", function: { name: "Bash" } } };
  repair(body);
  assert.equal(body.tool_choice, undefined, "dangling choice removed");
});

run("tool_choice naming a known tool is kept", () => {
  const body = { tools: [{ type: "function", function: { name: "Read" } }], tool_choice: { type: "tool", function: { name: "Read" } } };
  repair(body);
  assert.equal(body.tool_choice.type, "tool", "valid choice kept");
});

run("forced tool_choice without any tools is removed", () => {
  const body = { messages: [], tool_choice: "required" };
  repair(body);
  assert.equal(body.tool_choice, undefined, "forced choice without tools removed");
});

// --- repair: fail-open ---

run("garbage input is returned untouched", () => {
  assert.equal(repair(null), null, "null survives");
  assert.equal(repair("nope"), "nope", "non-object survives");
});

// --- isToolCallRejection ---

run("a 400 naming tools is a tool rejection", () => {
  assert.ok(isToolCallRejection(400, "Invalid schema for function 'Bash': tools[0].parameters"), "tool 400 detected");
});

run("a context overflow is not a tool rejection", () => {
  assert.equal(isToolCallRejection(400, "This model's maximum context length is 8192 tokens"), false, "overflow excluded");
});

run("a 429 is not a tool rejection", () => {
  assert.equal(isToolCallRejection(429, "rate limit exceeded"), false, "429 excluded");
});

run("an empty message is not a tool rejection", () => {
  assert.equal(isToolCallRejection(400, ""), false, "empty excluded");
});

// --- degrade ---

run("level 1 drops tool_choice and strict", () => {
  const body = {
    tools: [{ type: "function", strict: true, function: { name: "Bash", parameters: { type: "object" } } }],
    tool_choice: "required",
  };
  const out = degrade(body, 1);
  assert.equal(out.tool_choice, undefined, "tool_choice dropped");
  assert.equal(out.tools[0].strict, undefined, "strict dropped");
  assert.equal(out.tools[0].function.name, "Bash", "tool name kept");
  assert.equal(body.tool_choice, "required", "original body untouched");
});

run("level 2 strips fragile schema keywords but keeps the shape", () => {
  const body = {
    tools: [{
      type: "function",
      function: {
        name: "Bash",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { command: { type: "string", const: "ls" }, list: { type: "array", items: { oneOf: [{ type: "string" }] } } },
          required: ["command"],
        },
      },
    }],
  };
  const out = degrade(body, 2);
  const params = out.tools[0].function.parameters;
  assert.equal(params.additionalProperties, undefined, "additionalProperties stripped");
  assert.equal(params.properties.command.const, undefined, "const stripped");
  assert.equal(params.properties.list.items.oneOf, undefined, "oneOf stripped");
  assert.equal(params.properties.command.type, "string", "type kept");
  assert.equal(params.required[0], "command", "required kept");
});

run("level 2 also strips Claude input_schema", () => {
  const body = { tools: [{ name: "Bash", input_schema: { type: "object", additionalProperties: false, properties: {} } }] };
  const out = degrade(body, 2);
  assert.equal(out.tools[0].input_schema.additionalProperties, undefined, "claude schema stripped");
});

run("level 3 removes tools and inlines the tool history", () => {
  const body = {
    tools: [{ type: "function", function: { name: "Bash", parameters: { type: "object" } } }],
    messages: [
      { role: "user", content: "list files" },
      { role: "assistant", tool_calls: [{ id: "a", function: { name: "Bash", arguments: '{"command":"ls"}' } }] },
      { role: "tool", tool_call_id: "a", content: "package.json" },
    ],
  };
  const out = degrade(body, 3);
  assert.equal(out.tools, undefined, "tools removed");
  assert.equal(out.messages.length, 3, "turn count preserved");
  assert.equal(out.messages[1].tool_calls, undefined, "tool_calls inlined");
  assert.ok(out.messages[1].content.includes("Bash"), "tool name inlined");
  assert.ok(out.messages[2].content.includes("package.json"), "result inlined");
  assert.ok(body.tools, "original body untouched");
});

run("level 3 inlines Claude tool_use and tool_result blocks", () => {
  const body = {
    tools: [{ name: "Bash", input_schema: {} }],
    messages: [
      { role: "user", content: "list files" },
      { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "package.json" }] },
    ],
  };
  const out = degrade(body, 3);
  assert.equal(out.tools, undefined, "tools removed");
  assert.ok(out.messages[1].content.includes("Bash"), "tool_use inlined");
  assert.ok(out.messages[2].content.includes("package.json"), "tool_result inlined");
});

run("level 3 flattens Responses function items", () => {
  const body = {
    tools: [{ type: "function", name: "Bash", parameters: {} }],
    input: [
      { type: "message", role: "user", content: [] },
      { type: "function_call", call_id: "c1", name: "Bash", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "package.json" },
    ],
  };
  const out = degrade(body, 3);
  assert.equal(out.tools, undefined, "tools removed");
  assert.equal(out.input.length, 1, "function items removed");
});

run("degrade returns null once there are no tools left", () => {
  assert.equal(degrade({ messages: [] }, 3), null, "no tools -> null");
  assert.equal(degrade({ tools: [], tool_choice: "auto" }, 1), null, "nothing to drop -> null");
});

run("degrade past the last level returns null", () => {
  const body = { tools: [{ type: "function", function: { name: "Bash" } }] };
  assert.equal(degrade(body, TOOL_FALLBACK_MAX_LEVEL + 1), null, "beyond max level -> null");
});

run("degrade is fail-open on garbage", () => {
  assert.equal(degrade(null, 1), null, "null survives");
  assert.equal(degrade("nope", 2), null, "non-object survives");
});

const failed = results.filter(r => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
