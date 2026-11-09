import { describe, it, expect, vi } from "vitest";

const { cleanJSONSchemaForAntigravity } = await import("../../open-sse/translator/formats/gemini.js");
const { stripUnexpectedReasonArg, findToolSchema, openAICompletionToClaudeMessage, sanitizeAskUserQuestionArgs, sanitizeStartSessionArgs } = await import("../../open-sse/translator/concerns/claudeMessage.js");
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

  it("cleanJSONSchemaForAntigravity leaves AskUserQuestion annotations and answers as empty objects without synthetic reason", () => {
    const askUserQuestionSchema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: { question: { type: "string" } }
          }
        },
        answers: { type: "object" },
        annotations: { type: "object" }
      },
      required: ["questions"]
    };
    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(askUserQuestionSchema));
    expect(cleaned.properties.annotations).toEqual({ type: "object", properties: {} });
    expect(cleaned.properties.annotations.properties.reason).toBeUndefined();
    expect(cleaned.properties.answers).toEqual({ type: "object", properties: {} });
    expect(cleaned.properties.answers.properties.reason).toBeUndefined();
  });

  it("sanitizeAskUserQuestionArgs strips malformed string in annotations.reason and removes empty annotations", () => {
    const args = {
      questions: [
        {
          question: "Do you want to proceed?",
          header: "Confirm",
          options: [{ label: "Yes", description: "Proceed" }],
          multiSelect: false
        }
      ],
      annotations: {
        reason: "Need confirmation before proceeding"
      }
    };
    sanitizeAskUserQuestionArgs("AskUserQuestion", args);
    expect(args.annotations).toBeUndefined();
    expect(args.questions).toBeDefined();
  });

  it("sanitizeAskUserQuestionArgs preserves legitimate per-question object annotations", () => {
    const args = {
      questions: [
        {
          question: "Choose a theme",
          header: "Theme",
          options: [{ label: "Dark", description: "Dark mode" }],
          multiSelect: false
        }
      ],
      annotations: {
        "Choose a theme": {
          notes: "User prefers dark mode",
          preview: "preview text"
        }
      }
    };
    sanitizeAskUserQuestionArgs("AskUserQuestion", args);
    expect(args.annotations).toBeDefined();
    expect(args.annotations["Choose a theme"]).toEqual({
      notes: "User prefers dark mode",
      preview: "preview text"
    });
  });

  it("sanitizeAskUserQuestionArgs strips synthetic reason from answers and top-level", () => {
    const args = {
      questions: [],
      answers: { reason: "synthetic answer reason" },
      reason: "synthetic top-level reason"
    };
    sanitizeAskUserQuestionArgs("AskUserQuestion", args);
    expect(args.answers).toBeUndefined();
    expect(args.reason).toBeUndefined();
  });

  it("sanitizeStartSessionArgs rewrites initiation and target", () => {
    const args = {
      initiation: "offer",
      target: "cloud",
      prompt: "Investigate performance"
    };
    sanitizeStartSessionArgs("start_session", args);
    expect(args.initiation).toBe("user_asked");
    expect(args.target).toBe("local");
  });

  it("openaiToClaudeResponse sanitizes streaming AskUserQuestion annotations.reason", () => {
    const state = {
      body: {},
      toolCalls: new Map(),
      toolArgBuffers: new Map()
    };

    const chunk1 = {
      id: "chatcmpl-stream-askuser",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_askuser_789",
                function: {
                  name: "AskUserQuestion",
                  arguments: JSON.stringify({
                    questions: [{ question: "Proceed?", header: "Confirm", options: [{ label: "Yes", description: "Go" }], multiSelect: false }],
                    annotations: { reason: "Need approval" }
                  })
                }
              }
            ]
          }
        }
      ]
    };
    openaiToClaudeResponse(chunk1, state);

    const finishChunk = { choices: [{ finish_reason: "tool_calls" }] };
    const events = openaiToClaudeResponse(finishChunk, state);
    const deltaEvent = events.find(e => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(deltaEvent).toBeDefined();
    const parsedInput = JSON.parse(deltaEvent.delta.partial_json);
    expect(parsedInput.annotations).toBeUndefined();
    expect(parsedInput.questions[0].question).toBe("Proceed?");
  });
});
