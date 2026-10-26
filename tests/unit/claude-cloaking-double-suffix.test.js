/**
 * Regression for decolua/9router#5170: cloakClaudeTools must not double-suffix
 * tool names that already carry CLAUDE_TOOL_SUFFIX (e.g. echoed back in history).
 */
import { describe, it, expect } from "vitest";
import { cloakClaudeTools, decloakToolNames } from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

const schema = { type: "object", properties: {} };

describe("cloakClaudeTools double-suffix (#5170)", () => {
  it("(a) history tool_use already suffixed is not re-suffixed", () => {
    const { body } = cloakClaudeTools({
      tools: [{ name: "bash", description: "run", input_schema: schema }],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: `bash${CLAUDE_TOOL_SUFFIX}`, input: {} }] },
      ],
    });
    const hist = body.messages[0].content[0];
    expect(hist.name).toBe(`bash${CLAUDE_TOOL_SUFFIX}`);
    expect(hist.name).not.toBe(`bash${CLAUDE_TOOL_SUFFIX}${CLAUDE_TOOL_SUFFIX}`);
  });

  it("(b) tool declared already suffixed is not double-suffixed and restores", () => {
    const { body, toolNameMap } = cloakClaudeTools({
      tools: [{ name: `bash${CLAUDE_TOOL_SUFFIX}`, description: "run", input_schema: schema }],
      messages: [],
    });
    const declared = body.tools.find((t) => t.name.startsWith("bash"));
    expect(declared.name).toBe(`bash${CLAUDE_TOOL_SUFFIX}`);
    const restored = decloakToolNames(
      { content: [{ type: "tool_use", id: "t", name: `bash${CLAUDE_TOOL_SUFFIX}`, input: {} }] },
      toolNameMap,
    );
    expect(restored.content[0].name).toBe(`bash${CLAUDE_TOOL_SUFFIX}`);
  });

  it("(c) normal 'bash' -> 'bash_ide' unchanged, map restores to 'bash'", () => {
    const { body, toolNameMap } = cloakClaudeTools({
      tools: [{ name: "bash", description: "run", input_schema: schema }],
      messages: [],
    });
    expect(body.tools.some((t) => t.name === `bash${CLAUDE_TOOL_SUFFIX}`)).toBe(true);
    expect(toolNameMap.get(`bash${CLAUDE_TOOL_SUFFIX}`)).toBe("bash");
  });

  it("(d) built-in typed tools untouched", () => {
    const builtin = { type: "web_search_20250305", name: "web_search", max_uses: 3 };
    const { body } = cloakClaudeTools({ tools: [builtin], messages: [] });
    expect(body.tools[0]).toEqual(builtin);
  });
});
