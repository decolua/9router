// Fixes for agent clients (Claude Code) driving non-Anthropic upstreams:
// - tool-result images survive the Claude → OpenAI / Kiro request translation
// - Kiro tool calls stream back under the client's own (unsanitized) names
// - the client's thinking `display` is kept on Claude-format upstreams
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { kiroToClaudeResponse } from "../../open-sse/translator/response/kiro-to-claude.js";
import { kiroToOpenAIResponse } from "../../open-sse/translator/response/kiro-to-openai.js";
import { selectAnthropicBeta } from "../../open-sse/providers/shared.js";
import { hoistToolResultImages } from "../../open-sse/translator/formats/claude.js";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const screenshotTurn = (extraTools = []) => ({
  tools: [
    { name: "mcp__browser__computer", description: "browser", input_schema: { type: "object", properties: {} } },
    ...extraTools,
  ],
  messages: [
    { role: "user", content: "take a screenshot" },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "mcp__browser__computer", input: { action: "screenshot" } }] },
    {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: [
          { type: "text", text: "Successfully captured screenshot (1x1, png)" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
        ],
      }],
    },
  ],
});

describe("tool-result images reach OpenAI-format upstreams", () => {
  it("emits the tool message text and a follow-up user message carrying the image", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-x", screenshotTurn(), true, null, "openai");
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("toolu_1");
    expect(toolMsg.content).toBe("Successfully captured screenshot (1x1, png)");
    expect(toolMsg.content).not.toContain(PNG);
    const follow = out.messages[out.messages.indexOf(toolMsg) + 1];
    expect(follow.role).toBe("user");
    const image = follow.content.find((p) => p.type === "image_url");
    expect(image.image_url.url).toBe(`data:image/png;base64,${PNG}`);
    expect(follow.content.find((p) => p.type === "text").text).toContain("toolu_1");
  });

  it("does not dump base64 into a tool message that had no text", () => {
    const body = screenshotTurn();
    body.messages[2].content[0].content = [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }];
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-x", body, true, null, "openai");
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.content).toBe("");
    expect(out.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"))).toBe(true);
  });

  it("leaves text-only tool results exactly as before", () => {
    const body = screenshotTurn();
    body.messages[2].content[0].content = "plain result";
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-x", body, true, null, "openai");
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.content).toBe("plain result");
    expect(out.messages[out.messages.length - 1]).toBe(toolMsg);
  });

  it("forwards tool-result images to Kiro as user images", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", screenshotTurn(), true, null, "kiro");
    const json = JSON.stringify(out.conversationState);
    expect(json).toContain(PNG);
    expect(json).toContain("Successfully captured screenshot");
  });
});

describe("Kiro tool names round-trip", () => {
  it("returns the sanitized→original map on the translated body", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", screenshotTurn(), true, null, "kiro");
    expect(out._toolNameMap).toBeInstanceOf(Map);
    expect(out._toolNameMap.get("mcp_browser_computer")).toBe("mcp__browser__computer");
    const wire = JSON.parse(JSON.stringify(out.conversationState));
    expect(JSON.stringify(wire)).toContain("mcp_browser_computer");
    expect(JSON.stringify(wire)).not.toContain("mcp__browser__computer");
  });

  it("omits the map when no name changed", () => {
    const body = screenshotTurn();
    body.tools = [{ name: "plain_tool", description: "x", input_schema: { type: "object", properties: {} } }];
    body.messages[1].content[0].name = "plain_tool";
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, true, null, "kiro");
    expect(out._toolNameMap).toBeUndefined();
  });

  it("restores the client name on streamed Claude tool_use blocks", () => {
    const state = { ...initState(FORMATS.CLAUDE), toolNameMap: new Map([["mcp_browser_computer", "mcp__browser__computer"]]) };
    const chunk = {
      id: "c1", object: "chat.completion.chunk", created: 1, model: "claude-sonnet-4.5",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "mcp_browser_computer", arguments: "" } }] }, finish_reason: null }],
    };
    const events = kiroToClaudeResponse(chunk, state);
    const start = events.find((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(start.content_block.name).toBe("mcp__browser__computer");
  });

  it("passes unknown names through untouched", () => {
    const state = { ...initState(FORMATS.CLAUDE), toolNameMap: new Map([["mcp_browser_computer", "mcp__browser__computer"]]) };
    const chunk = {
      id: "c1", object: "chat.completion.chunk", created: 1, model: "claude-sonnet-4.5",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "other_tool", arguments: "" } }] }, finish_reason: null }],
    };
    const events = kiroToClaudeResponse(chunk, state);
    const start = events.find((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(start.content_block.name).toBe("other_tool");
  });

  it("restores the client name on OpenAI chunks passed through kiro-to-openai", () => {
    const state = { ...initState(FORMATS.OPENAI), toolNameMap: new Map([["mcp_browser_computer", "mcp__browser__computer"]]) };
    const chunk = {
      id: "c1", object: "chat.completion.chunk", created: 1, model: "claude-sonnet-4.5",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "mcp_browser_computer", arguments: "{}" } }] }, finish_reason: null }],
    };
    const out = kiroToOpenAIResponse(chunk, state);
    expect(out.choices[0].delta.tool_calls[0].function.name).toBe("mcp__browser__computer");
    expect(kiroToOpenAIResponse(chunk, initState(FORMATS.OPENAI))).toBe(chunk);
  });
});

describe("thinking display is preserved for Claude-format upstreams", () => {
  it("keeps display on adaptive thinking", () => {
    const body = { model: "claude-sonnet-5", thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" }, messages: [] };
    applyThinking(FORMATS.CLAUDE, "claude-sonnet-5", body, "claude");
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("keeps display on budget thinking and omits it when the client sent none", () => {
    const withDisplay = { model: "claude-haiku-4-5-20251001", thinking: { type: "adaptive", display: "omitted" }, output_config: { effort: "low" }, messages: [] };
    applyThinking(FORMATS.CLAUDE, "claude-haiku-4-5-20251001", withDisplay, "claude");
    expect(withDisplay.thinking.type).toBe("enabled");
    expect(withDisplay.thinking.display).toBe("omitted");

    const without = { model: "claude-sonnet-5", thinking: { type: "adaptive" }, output_config: { effort: "high" }, messages: [] };
    applyThinking(FORMATS.CLAUDE, "claude-sonnet-5", without, "claude");
    expect(without.thinking).toEqual({ type: "adaptive" });
  });
});

describe("redact-thinking beta follows the client's display request", () => {
  it("keeps redact-thinking by default and drops it for summarized display", () => {
    expect(selectAnthropicBeta("claude-sonnet-5")).toContain("redact-thinking-2026-02-12");
    expect(selectAnthropicBeta("claude-sonnet-5", { thinking: { type: "adaptive", display: "omitted" } })).toContain("redact-thinking-2026-02-12");
    const summarized = selectAnthropicBeta("claude-sonnet-5", { thinking: { type: "adaptive", display: "summarized" } });
    expect(summarized).not.toContain("redact-thinking-2026-02-12");
    expect(summarized).toContain("interleaved-thinking-2025-05-14");
    expect(summarized).toContain("effort-2025-11-24");
  });
});

describe("tool-result images reach Anthropic-compatible and Command Code upstreams", () => {
  it("hoists a tool_result image into the same user turn after the results", () => {
    const body = screenshotTurn();
    const out = hoistToolResultImages(body);
    const user = out.messages[2];
    expect(user.content[0].type).toBe("tool_result");
    expect(user.content[0].content.every((c) => c.type !== "image")).toBe(true);
    expect(user.content.some((c) => c.type === "image" && c.source?.data === PNG)).toBe(true);
    expect(user.content.find((c) => c.type === "text" && /toolu_1/.test(c.text))).toBeTruthy();
    // No image: untouched object identity.
    const plain = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] }] };
    expect(hoistToolResultImages(plain)).toBe(plain);
  });

  it("sends an image block to Command Code instead of a placeholder", () => {
    const openaiBody = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "muse-spark", screenshotTurn(), true, null, "commandcode");
    const out = openaiToCommandCodeRequest("muse-spark", openaiBody, true);
    const json = JSON.stringify(out);
    expect(json).not.toContain("[image omitted]");
    expect(json).toContain(`"type":"image"`);
    expect(json).toContain(`data:image/png;base64,${PNG}`);
    expect(json).toContain(`"mediaType":"image/png"`);
  });
});
