/**
 * Unit tests for open-sse/utils/claudeCloaking.js
 *
 * Tests cover:
 *  - cloakClaudeTools() - TitleCase remapping and forced tool_choice
 *  - applyCloaking() - system prompt relocation + billing header
 *  - decloakStreamChunk() - restoring tool names in streamed Claude SSE events
 */

import { describe, it, expect } from "vitest";
import {
  applyCloaking,
  cloakClaudeTools,
  cloakOAuthToolName,
  decloakStreamChunk,
  extractClaudeSessionIdFromUserId,
  prependToFirstUserMessage,
} from "../../open-sse/utils/claudeCloaking.js";
import { CLAUDE_CLI_VERSION } from "../../open-sse/providers/shared.js";
import { CLAUDE_SYSTEM_PROMPT, CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

it("advertises the current Claude Code fingerprint version", () => {
  const body = applyCloaking({ messages: [] }, "sk-ant-oat-test", "session-id");
  expect(body.system[0].text).toMatch(
    new RegExp(`^x-anthropic-billing-header: cc_version=${CLAUDE_CLI_VERSION}\\.`)
  );
});

describe("applyCloaking system relocation", () => {
  it("keeps only billing + Claude Code prompt in system[] and moves extras to first user message", () => {
    const body = applyCloaking(
      {
        system: [
          { type: "text", text: CLAUDE_SYSTEM_PROMPT },
          { type: "text", text: "You are Hermes Agent, an intelligent AI assistant created by Nous Research." },
        ],
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      "sk-ant-oat-test",
      "sess-1"
    );

    expect(body.system).toHaveLength(2);
    expect(body.system[0].text).toMatch(/^x-anthropic-billing-header:/);
    expect(body.system[1].text).toBe(CLAUDE_SYSTEM_PROMPT);
    expect(body.messages[0].content[0].text).toContain("Hermes Agent");
    expect(body.messages[0].content[1].text).toBe("hi");
  });

  it("is a no-op for non-OAuth API keys", () => {
    const input = { system: "keep me", messages: [] };
    expect(applyCloaking(input, "sk-ant-api-key", "s")).toBe(input);
  });

  it("writes metadata.user_id with a clean session_id", () => {
    const body = applyCloaking({ messages: [] }, "sk-ant-oat-test", "claude:abc-123");
    const uid = JSON.parse(body.metadata.user_id);
    expect(uid.session_id).toBe("abc-123");
    expect(uid.account_uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe("cloakOAuthToolName", () => {
  it("maps snake_case / lowercase names to Claude Code TitleCase", () => {
    expect(cloakOAuthToolName("bash")).toBe("Bash");
    expect(cloakOAuthToolName("web_search")).toBe("WebSearch");
    expect(cloakOAuthToolName("todo_write")).toBe("TodoWrite");
    expect(cloakOAuthToolName("run_code")).toBe("RunCode");
  });
});

describe("cloakClaudeTools", () => {
  const baseBody = {
    tools: [{ name: "todo_write", description: "write todos", input_schema: { type: "object", properties: {} } }],
    messages: [{ role: "user", content: [{ type: "text", text: "add a todo" }] }],
  };

  it("TitleCases client tool names and maps them back", () => {
    const { body, toolNameMap } = cloakClaudeTools(baseBody);
    expect(body.tools.find((t) => t.name === "TodoWrite")).toBeDefined();
    expect(toolNameMap.get("TodoWrite")).toBe("todo_write");
    // Decoy for Bash still present; TodoWrite is client-owned so not duplicated as decoy
    expect(body.tools.filter((t) => t.name === "TodoWrite")).toHaveLength(1);
    expect(body.tools.some((t) => t.name === "Bash")).toBe(true);
  });

  it("maps web_search onto the Claude Code WebSearch name", () => {
    const { body, toolNameMap } = cloakClaudeTools({
      tools: [{ name: "web_search", input_schema: { type: "object", properties: {} } }],
      messages: [],
    });
    expect(body.tools.find((t) => t.name === "WebSearch")?.description).not.toBe(
      "This tool is currently unavailable."
    );
    expect(toolNameMap.get("WebSearch")).toBe("web_search");
  });

  it("rewrites a forced tool_choice to match the cloaked tool", () => {
    const { body } = cloakClaudeTools({
      ...baseBody,
      tool_choice: { type: "tool", name: "todo_write" },
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: "TodoWrite" });
  });

  it("rewrites only the chosen tool when several are present", () => {
    const { body } = cloakClaudeTools({
      tools: [
        { name: "search", input_schema: { type: "object", properties: {} } },
        { name: "todo_write", input_schema: { type: "object", properties: {} } },
      ],
      tool_choice: { type: "tool", name: "todo_write" },
    });
    expect(body.tool_choice).toEqual({ type: "tool", name: "TodoWrite" });
  });

  it("leaves non-forced tool_choice untouched", () => {
    const auto = cloakClaudeTools({ ...baseBody, tool_choice: { type: "auto" } });
    expect(auto.body.tool_choice).toEqual({ type: "auto" });

    const none = cloakClaudeTools({ ...baseBody });
    expect(none.body.tool_choice).toBeUndefined();
  });

  it("does not rewrite a forced choice that targets a decoy/built-in tool", () => {
    const { body } = cloakClaudeTools({ ...baseBody, tool_choice: { type: "tool", name: "Bash" } });
    expect(body.tool_choice).toEqual({ type: "tool", name: "Bash" });
  });

  it("renames tool_use names in message history", () => {
    const { body } = cloakClaudeTools({
      ...baseBody,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "todo_write", input: {} }] },
      ],
    });
    expect(body.messages[0].content[0].name).toBe("TodoWrite");
  });

  it("returns the body unchanged when there are no tools", () => {
    const input = { messages: [{ role: "user", content: "hi" }], tool_choice: { type: "tool", name: "x" } };
    const { body, toolNameMap } = cloakClaudeTools(input);
    expect(body).toBe(input);
    expect(toolNameMap).toBeNull();
  });
});

describe("decloakStreamChunk", () => {
  const toolNameMap = new Map([["RunCode", "run_code"]]);

  const toolUseStart = (name) => ({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_01abc", name, input: {} },
  });

  it("restores the original name on a tool_use content_block_start", () => {
    const out = decloakStreamChunk(toolUseStart("RunCode"), toolNameMap);
    expect(out.content_block.name).toBe("run_code");
  });

  it("does not mutate the input chunk", () => {
    const chunk = toolUseStart("RunCode");
    decloakStreamChunk(chunk, toolNameMap);
    expect(chunk.content_block.name).toBe("RunCode");
  });

  it("passes through names the map does not know (e.g. decoy tools)", () => {
    const chunk = toolUseStart("Bash");
    expect(decloakStreamChunk(chunk, toolNameMap)).toBe(chunk);
  });

  it("passes through non-tool_use events unchanged", () => {
    const textStart = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    expect(decloakStreamChunk(textStart, toolNameMap)).toBe(textStart);

    const delta = { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } };
    expect(decloakStreamChunk(delta, toolNameMap)).toBe(delta);
  });

  it("tolerates null chunks and missing maps (stream flush path)", () => {
    expect(decloakStreamChunk(null, toolNameMap)).toBeNull();
    expect(decloakStreamChunk(toolUseStart("RunCode"), null).content_block.name).toBe("RunCode");
    expect(decloakStreamChunk(toolUseStart("RunCode"), new Map()).content_block.name).toBe("RunCode");
  });

  it("falls back to stripping legacy *_ide suffix when the map is missing", () => {
    expect(decloakStreamChunk(toolUseStart("run_code" + CLAUDE_TOOL_SUFFIX), null).content_block.name).toBe("run_code");
    expect(decloakStreamChunk(toolUseStart("run_code" + CLAUDE_TOOL_SUFFIX), new Map()).content_block.name).toBe("run_code");
    expect(decloakStreamChunk(toolUseStart("uncloaked_tool"), null).content_block.name).toBe("uncloaked_tool");
  });
});

describe("session id helpers", () => {
  it("extracts session_id from Claude Code JSON user_id", () => {
    expect(
      extractClaudeSessionIdFromUserId(
        '{"device_id":"abc","account_uuid":"u","session_id":"sess-9"}'
      )
    ).toBe("sess-9");
  });

  it("prepends text ahead of existing user content blocks", () => {
    const out = prependToFirstUserMessage(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      "extra"
    );
    expect(out[0].content[0].text).toBe("extra");
    expect(out[0].content[1].text).toBe("hi");
  });
});
