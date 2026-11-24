import { describe, expect, it } from "vitest";
import { getTargetFormat } from "../../open-sse/services/provider.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import {
  buildToolCallResponse as buildDeepSeekToolCallResponse,
  buildToolSystemPrompt as buildDeepSeekToolSystemPrompt,
  emitToolCallChunks as emitDeepSeekToolCallChunks,
  hasTools as deepSeekHasTools,
  parseToolCallReply as parseDeepSeekToolCallReply,
} from "../../open-sse/executors/deepseekWebToolBridge.js";
import {
  buildToolCallResponse as buildGeminiToolCallResponse,
  buildToolInstructions as buildGeminiToolInstructions,
  emitToolCallChunks as emitGeminiToolCallChunks,
  hasTools as geminiHasTools,
  parseToolCallReply as parseGeminiToolCallReply,
} from "../../open-sse/executors/webCookieToolBridge.js";

const providers = [
  ["deepseek-web", "deepseek-chat"],
  ["gemini-web", "gemini-3.8-flash"],
];
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];
const calls = [{ name: "read_file", arguments: { path: "README.md" } }];

function expectOpenAICompletion(response) {
  expect(response.object).toBe("chat.completion");
  expect(response.choices[0].finish_reason).toBe("tool_calls");
  expect(response.choices[0].message.tool_calls[0]).toMatchObject({
    type: "function",
    function: {
      name: "read_file",
      arguments: JSON.stringify({ path: "README.md" }),
    },
  });
}

function expectOpenAIStream(emit) {
  const chunks = [];
  const emitted = emit((delta, finishReason) => chunks.push({ delta, finishReason }), () => {}, calls);

  expect(emitted).toBe(true);
  expect(chunks[0].delta.tool_calls[0]).toMatchObject({
    type: "function",
    function: {
      name: "read_file",
      arguments: JSON.stringify({ path: "README.md" }),
    },
  });
  expect(chunks.at(-1)).toEqual({ delta: {}, finishReason: "tool_calls" });
}

describe.each(providers)("%s tool-calling bridge", (provider, model) => {
  it("declares the canonical OpenAI format consumed and returned by the executor", () => {
    expect(getTargetFormat(provider)).toBe("openai");
  });

  it("advertises tool calling as a supported model capability", () => {
    expect(getCapabilitiesForModel(provider, model).tools).toBe(true);
  });
});

describe("DeepSeek Web cookie tool-call bridge", () => {
  it("encodes advertised tools into the prompt and recovers a tool call", () => {
    expect(deepSeekHasTools({ tools })).toBe(true);
    expect(buildDeepSeekToolSystemPrompt(tools)).toContain("read_file");

    const parsed = parseDeepSeekToolCallReply(
      '<<TOOL_CALL>> {"name":"read_file","arguments":{"path":"README.md"}} <<TOOL_CALL>>',
    );
    expect(parsed.calls).toEqual(calls);
  });

  it("returns OpenAI-compatible non-streaming and streaming tool calls", () => {
    expectOpenAICompletion(buildDeepSeekToolCallResponse({
      id: "chatcmpl-deepseek",
      model: "deepseek-chat",
      messageText: "",
      calls,
    }));
    expectOpenAIStream(emitDeepSeekToolCallChunks);
  });
});

describe("Gemini Web cookie tool-call bridge", () => {
  it("encodes advertised tools into the prompt and recovers a tool call", () => {
    expect(geminiHasTools({ tools })).toBe(true);
    expect(buildGeminiToolInstructions({ tools }, "fenced")).toContain("read_file");

    const parsed = parseGeminiToolCallReply(
      '```tool_call\n{"name":"read_file","arguments":{"path":"README.md"}}\n```',
    );
    expect(parsed.calls).toEqual(calls);
  });

  it("returns OpenAI-compatible non-streaming and streaming tool calls", () => {
    expectOpenAICompletion(buildGeminiToolCallResponse({
      id: "chatcmpl-gemini",
      model: "gemini-3.8-flash",
      messageText: "",
      calls,
    }));
    expectOpenAIStream(emitGeminiToolCallChunks);
  });
});
