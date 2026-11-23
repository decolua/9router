import { describe, expect, it } from "vitest";
import { normalizeDeferredTools } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const addition = (name) => ({ type: "tool_addition", tool: { type: "tool_definition", definition: { name, description: "MCP tool", input_schema: { type: "object", properties: {} } } } });

describe("Kimi deferred MCP tools", () => {
  it("hoists definitions without duplicates, removes empty turns and leaves source untouched", () => {
    const body = { tools: [{ name: "existing", input_schema: { type: "object" } }], messages: [
      { role: "system", content: [addition("new_tool"), addition("new_tool"), addition("existing")] },
      { role: "user", content: [{ type: "text", text: "run" }, addition("other_tool")] },
    ] };
    const result = normalizeDeferredTools(body);
    expect(result.tools.map(t => t.name)).toEqual(["existing", "new_tool", "other_tool"]);
    expect(result.messages).toEqual([{ role: "user", content: [{ type: "text", text: "run" }] }]);
    expect(body.messages[0].content).toHaveLength(3);
    expect(body.tools).toHaveLength(1);
  });

  it("only normalizes Kimi-bound Claude requests", () => {
    const makeBody = () => ({ messages: [
      { role: "system", content: [{ type: "text", text: "context" }, addition("mcp_tool")] },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ] });
    const kimi = translateRequest("claude", "claude", "k3", makeBody(), true, null, "kimi");
    expect(kimi.tools.map(t => t.name)).toContain("mcp_tool");
    expect(JSON.stringify(kimi.messages)).not.toContain("tool_addition");
    const claude = translateRequest("claude", "claude", "claude-sonnet-4-6", makeBody(), true, null, "claude");
    expect(JSON.stringify(claude.messages)).toContain("tool_addition");
  });
});
