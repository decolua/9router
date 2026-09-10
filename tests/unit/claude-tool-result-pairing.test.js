import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const translate = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-fable-5", body, true, null, "github");

describe("Claude tool result pairing", () => {
  it("salvages orphaned results and fills missing parallel results", () => {
    const out = translate({
      messages: [
        { role: "user", content: "run" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call-valid",
            type: "function",
            function: { name: "exec", arguments: "{}" },
          }, {
            id: "call-missing",
            type: "function",
            function: { name: "read", arguments: "{}" },
          }],
        },
        { role: "tool", tool_call_id: "call-valid", content: "valid output" },
        { role: "tool", tool_call_id: "call-orphan", content: "orphan output" },
        { role: "user", content: "continue" },
      ],
    });

    const assistantIndex = out.messages.findIndex((message) =>
      message.role === "assistant" &&
      message.content.some((block) => block.type === "tool_use" && block.id === "call-valid")
    );
    const resultMessage = out.messages[assistantIndex + 1];
    const structuredResults = resultMessage.content.filter((block) => block.type === "tool_result");

    expect(structuredResults.map((block) => block.tool_use_id)).toEqual(["call-valid", "call-missing"]);
    expect(structuredResults[1].content).toBe("");
    expect(JSON.stringify(resultMessage.content)).toContain("valid output");
    expect(JSON.stringify(resultMessage.content)).toContain("orphan output");
  });

  it("salvages an orphaned result when it is the only message", () => {
    const out = prepareClaudeRequest({
      model: "claude-fable-5",
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call-orphan", content: "only output" }],
      }],
    }, "github");

    expect(out.messages[0].content.some((block) => block.type === "tool_result")).toBe(false);
    expect(JSON.stringify(out.messages[0].content)).toContain("only output");
  });

  it("keeps only the first matching result structured and salvages duplicates as text", () => {
    const out = prepareClaudeRequest({
      model: "claude-fable-5",
      messages: [{
        role: "assistant",
        content: [{ type: "tool_use", id: "call-1", name: "read", input: {} }],
      }, {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call-1", content: "first" },
          { type: "tool_result", tool_use_id: "call-1", content: "duplicate" },
        ],
      }],
    }, "github");

    const content = out.messages[1].content;
    expect(content.filter((block) => block.type === "tool_result")).toEqual([
      { type: "tool_result", tool_use_id: "call-1", content: "first" },
    ]);
    expect(content.find((block) => block.type === "text")?.text).toContain("duplicate");
  });

  it("does not stringify image-only orphan results into user text", () => {
    const out = prepareClaudeRequest({
      model: "claude-fable-5",
      messages: [{
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "call-orphan",
          content: [{
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "private-image-bytes" },
          }],
        }],
      }],
    }, "github");

    const serialized = JSON.stringify(out.messages[0].content);
    expect(serialized).toContain("Unpaired tool result call-orphan");
    expect(serialized).not.toContain("private-image-bytes");
    expect(serialized).not.toContain("base64");
  });

  it("preserves image content for a result paired to the immediate tool call", () => {
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "paired-image-bytes" },
    };
    const out = prepareClaudeRequest({
      model: "claude-fable-5",
      messages: [{
        role: "assistant",
        content: [{ type: "tool_use", id: "call-image", name: "capture", input: {} }],
      }, {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call-image", content: [image] }],
      }],
    }, "github");

    expect(out.messages[1].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "call-image",
      content: [image],
    });
  });

  it("treats a result after an intervening assistant turn as orphaned", () => {
    const out = prepareClaudeRequest({
      model: "claude-fable-5",
      messages: [{
        role: "assistant",
        content: [{ type: "tool_use", id: "old-call", name: "read", input: {} }],
      }, {
        role: "user",
        content: [{ type: "text", text: "continue" }],
      }, {
        role: "assistant",
        content: [{ type: "text", text: "new turn" }],
      }, {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "old-call", content: "late output" }],
      }],
    }, "github");

    expect(out.messages[3].content.some((block) => block.type === "tool_result")).toBe(false);
    expect(out.messages[3].content[0].text).toContain("late output");
  });
});
