// Regression: the forced-SSE->JSON collector must keep parallel tool calls
// separate when the provider streams them WITHOUT an index (positional
// name+args fragments). Previously a name-only fragment fell through to
// `lastToolIndex`, merging the second call into the first.
import { describe, expect, it } from "vitest";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

const tc = (o) => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { tool_calls: [o] }, finish_reason: null }] });
const fin = () => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
const sse = (chunks) => chunks.map((c) => `data: ${JSON.stringify(c)}\n`).join("") + "data: [DONE]\n";

describe("parseSSEToOpenAIResponse parallel calls without index", () => {
  it("keeps two positional id-less calls with different names separate", () => {
    const raw = sse([
      tc({ function: { name: "Read", arguments: '{"file_path":"/a"}' } }),
      tc({ function: { name: "Bash", arguments: '{"command":"ls"}' } }),
      fin(),
    ]);
    const out = parseSSEToOpenAIResponse(raw, "m");
    const calls = out.choices[0].message.tool_calls;
    expect(calls).toHaveLength(2);
    const byName = Object.fromEntries(calls.map((c) => [c.function.name, JSON.parse(c.function.arguments)]));
    expect(byName.Read).toEqual({ file_path: "/a" });
    expect(byName.Bash).toEqual({ command: "ls" });
  });

  it("still accumulates argument fragments into the current call", () => {
    const raw = sse([
      tc({ function: { name: "Read", arguments: '{"file_' } }),
      tc({ function: { arguments: 'path":"/a"}' } }),
      fin(),
    ]);
    const out = parseSSEToOpenAIResponse(raw, "m");
    const calls = out.choices[0].message.tool_calls;
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ file_path: "/a" });
  });
});
