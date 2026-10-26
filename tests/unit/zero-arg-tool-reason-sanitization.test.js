import { describe, it, expect, vi } from "vitest";

const { cleanJSONSchemaForAntigravity } = await import("../../open-sse/translator/formats/gemini.js");
const { stripUnexpectedReasonArg, findToolSchema, openAICompletionToClaudeMessage } = await import("../../open-sse/translator/concerns/claudeMessage.js");
const { openaiToClaudeResponse } = await import("../../open-sse/translator/response/openai-to-claude.js");

describe("Zero-parameter and empty-schema tool argument sanitization (CronList/TaskList #4762)", () => {
  it("cleanJSONSchemaForAntigravity does NOT inject synthetic reason parameter", () => {
    const cronListSchema = {
      type: "object",
      properties: {},
      required: []
    };
    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(cronListSchema));
    expect(cleaned.properties).toEqual({});
    expect(cleaned.properties.reason).toBeUndefined();
    expect(cleaned.required).toBeUndefined();
  });

  it("findToolSchema resolves tool schema by exact name or with proxy_ prefix", () => {
    const tools = [
      {
        name: "CronList",
        input_schema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "Bash",
        input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
      }
    ];

    expect(findToolSchema("CronList", tools)).toBeDefined();
    expect(findToolSchema("proxy_CronList", tools)).toBeDefined();
    expect(findToolSchema("Bash", tools)).toBeDefined();
    expect(findToolSchema("NonExistent", tools)).toBeNull();
  });

  it("stripUnexpectedReasonArg removes reason when tool schema has no reason property", () => {
    const tools = [
      {
        name: "CronList",
        input_schema: { type: "object", properties: {}, required: [] }
      }
    ];
    const args = { reason: "Brief explanation of why you are calling this tool" };
    stripUnexpectedReasonArg("CronList", args, tools);
    expect(args).toEqual({});
    expect(args.reason).toBeUndefined();
  });

  it("stripUnexpectedReasonArg preserves reason when tool schema explicitly declares reason", () => {
    const tools = [
      {
        name: "CustomTool",
        input_schema: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Legitimate reason parameter" }
          },
          required: ["reason"]
        }
      }
    ];
    const args = { reason: "legitimate user explanation" };
    stripUnexpectedReasonArg("CustomTool", args, tools);
    expect(args.reason).toBe("legitimate user explanation");
  });

  it("stripUnexpectedReasonArg removes reason for known zero-arg tools even if tools array is omitted", () => {
    const args1 = { reason: "test reason" };
    stripUnexpectedReasonArg("CronList", args1, null);
    expect(args1).toEqual({});

    const args2 = { reason: "test reason" };
    stripUnexpectedReasonArg("TaskList", args2, undefined);
    expect(args2).toEqual({});
  });

  it("openAICompletionToClaudeMessage sanitizes tool call arguments for CronList", () => {
    const responseBody = {
      id: "chatcmpl-test-cronlist",
      model: "claude-fable-5-1",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_cronlist_123",
                type: "function",
                function: {
                  name: "CronList",
                  arguments: JSON.stringify({ reason: "Brief explanation of why you are calling this tool" })
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    };

    const options = {
      body: {
        tools: [
          {
            name: "CronList",
            input_schema: { type: "object", properties: {}, required: [] }
          }
        ]
      }
    };

    const result = openAICompletionToClaudeMessage(responseBody, options);
    expect(result.content[0].type).toBe("tool_use");
    expect(result.content[0].name).toBe("CronList");
    expect(result.content[0].input).toEqual({});
    expect(result.content[0].input.reason).toBeUndefined();
  });

  it("openaiToClaudeResponse stream sanitizes tool call arguments on finish", () => {
    const state = {
      body: {
        tools: [
          {
            name: "CronList",
            input_schema: { type: "object", properties: {}, required: [] }
          }
        ]
      },
      toolCalls: new Map(),
      toolArgBuffers: new Map()
    };

    // First chunk starts tool call
    const chunk1 = {
      id: "chatcmpl-stream-cronlist",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_cronlist_456",
                function: {
                  name: "CronList",
                  arguments: "{\"reason\": \"Brief explanation\"}"
                }
              }
            ]
          }
        }
      ]
    };
    openaiToClaudeResponse(chunk1, state);

    // Finish chunk flushes and sanitizes args
    const finishChunk = {
      choices: [
        {
          finish_reason: "tool_calls"
        }
      ]
    };
    const events = openaiToClaudeResponse(finishChunk, state);
    const deltaEvent = events.find(e => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(deltaEvent).toBeDefined();
    const parsedInput = JSON.parse(deltaEvent.delta.partial_json);
    expect(parsedInput).toEqual({});
    expect(parsedInput.reason).toBeUndefined();
  });
});
