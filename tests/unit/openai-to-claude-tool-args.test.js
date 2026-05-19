import { describe, expect, it } from "vitest";

import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return {
    messageStartSent: false,
    nextBlockIndex: 0,
    toolCalls: new Map(),
    textBlockStarted: false,
    textBlockClosed: false,
    thinkingBlockStarted: false,
    requestBody: {
      tools: [
        {
          name: "Read",
          input_schema: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              pages: { type: "string" },
              offset: { type: "number" },
            },
            required: ["file_path"],
          },
        },
        {
          name: "RequiredEmpty",
          input_schema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      ],
    },
  };
}

function emitToolCall(state, name, args) {
  openaiToClaudeResponse({
    id: "chatcmpl_test",
    model: "gpt-5.5-high",
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: "" } }] } }],
  }, state);

  openaiToClaudeResponse({
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }],
  }, state);

  return openaiToClaudeResponse({
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  }, state);
}

function getArgs(done) {
  const argDelta = done.find((item) => item.type === "content_block_delta" && item.delta?.type === "input_json_delta");
  return argDelta.delta.partial_json;
}

describe("openaiToClaudeResponse tool arguments", () => {
  it("removes optional empty string arguments before emitting final Claude tool input", () => {
    const done = emitToolCall(
      createState(),
      "Read",
      "{\"file_path\":\"/tmp/example.txt\",\"pages\":\"\",\"offset\":0}"
    );

    expect(JSON.parse(getArgs(done))).toEqual({ file_path: "/tmp/example.txt", offset: 0 });
  });

  it("preserves required empty string arguments", () => {
    const done = emitToolCall(createState(), "RequiredEmpty", "{\"value\":\"\"}");

    expect(JSON.parse(getArgs(done))).toEqual({ value: "" });
  });

  it("leaves malformed partial JSON unchanged", () => {
    const done = emitToolCall(createState(), "Read", "{\"file_path");

    expect(getArgs(done)).toBe("{\"file_path");
  });
});
