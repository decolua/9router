// A tool loop's request ends with the last assistant turn's tool results, after that turn's
// breakpoint: without a 4th breakpoint on them they go at the full input price, and are written
// into the cache only by the next request, which appends to them.
import { describe, it, expect } from "vitest";
import { anchorClaudeCache, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const CC = { type: "ephemeral" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name, extra = {}) => ({ name, description: "d", input_schema: { type: "object", properties: {} }, ...extra });
const toolUse = (id) => ({ role: "assistant", content: [text("Reading."), { type: "tool_use", id, name: "read_file", input: { path: "a" } }] });
const result = (id, content = "file") => ({ type: "tool_result", tool_use_id: id, content });

function markers(body) {
  const out = [];
  (body.system || []).forEach((b, i) => b?.cache_control && out.push(`system[${i}]`));
  (body.tools || []).forEach((t, i) => t?.cache_control && out.push(`tools[${i}]`));
  (body.messages || []).forEach((m, i) => Array.isArray(m?.content) && m.content.forEach((b, j) => b?.cache_control && out.push(`messages[${i}].${j}`)));
  return out;
}

const loop = () => ({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: [text("You are an agent.")],
  tools: [tool("read_file"), tool("run_command")],
  messages: [
    { role: "user", content: [text("Fix the bug.")] },
    toolUse("t1"),
    { role: "user", content: [result("t1")] },
    toolUse("t2"),
    { role: "user", content: [result("t2", "a"), result("t2b", "b")] },
  ],
});

describe("prepareClaudeRequest: a tool loop's final tool results", () => {
  it("get the 4th breakpoint, after the last assistant turn's", () => {
    const out = prepareClaudeRequest(loop(), "claude");
    expect(markers(out)).toEqual(["system[0]", "tools[1]", "messages[3].1", "messages[4].1"]);
    expect(out.messages[4].content[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("leave a request that ends with a typed message as it was", () => {
    const body = loop();
    body.messages.push({ role: "assistant", content: [text("Done.")] }, { role: "user", content: [text("Thanks, and the tests?")] });
    const out = prepareClaudeRequest(body, "claude");
    expect(markers(out)).toEqual(["system[0]", "tools[1]", "messages[5].0"]);
  });

  it("need no tools array to be marked", () => {
    const body = loop();
    delete body.tools;
    const out = prepareClaudeRequest(body, "claude");
    expect(markers(out)).toEqual(["system[0]", "messages[3].1", "messages[4].1"]);
  });

  it("never take the request past four markers", () => {
    const body = loop();
    body.system = [text("a", { cache_control: CC }), text("b", { cache_control: CC })];
    body.tools = body.tools.map((t) => ({ ...t, cache_control: CC }));
    body.messages.forEach((m) => m.content.forEach((b) => (b.cache_control = CC)));
    const out = prepareClaudeRequest(body, "claude");
    expect(markers(out).length).toBeLessThanOrEqual(4);
    expect(out.messages[4].content.at(-1).cache_control).toBeTruthy();
  });
});

describe("anchorClaudeCache: a passthrough tool loop's final tool results", () => {
  it("are re-anchored with the last assistant turn", () => {
    const out = anchorClaudeCache(loop());
    expect(markers(out)).toEqual(["system[0]", "tools[1]", "messages[3].1", "messages[4].1"]);
  });

  it("keep a client's own full budget as it is", () => {
    const body = loop();
    body.messages[0].content[0].cache_control = CC;
    body.messages[2].content[0].cache_control = CC;
    const out = anchorClaudeCache(body);
    expect(markers(out).length).toBeLessThanOrEqual(4);
  });
});
