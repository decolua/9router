import { describe, it, expect, vi } from "vitest";
import {
  estimateInputTokens,
  estimateOutputTokens,
  countResponseOutputChars,
  estimateResponseOutputTokens,
} from "../../open-sse/utils/usageTracking.js";
import { GeminiWebExecutor } from "../../open-sse/executors/gemini-web.js";
import { buildToolCallResponse } from "../../open-sse/executors/webCookieToolBridge.js";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const mocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: mocks.saveRequestUsage,
  saveRequestDetail: mocks.saveRequestDetail,
  appendRequestLog: mocks.appendRequestLog,
  trackPendingRequest: vi.fn(),
}));

describe("Token estimation utilities", () => {
  it("counts response output characters across text, reasoning and tool calls", () => {
    const openAIResponse = {
      choices: [
        {
          message: {
            content: "Hello world!",
            reasoning_content: "Thinking deeply about hello",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
        },
      ],
    };
    const chars = countResponseOutputChars(openAIResponse);
    expect(chars).toBe(
      "Hello world!".length +
      "Thinking deeply about hello".length +
      "get_weather".length +
      '{"city":"Tokyo"}'.length
    );
    const tokens = estimateResponseOutputTokens(openAIResponse);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.floor(chars / 4));
  });

  it("counts Claude format content blocks", () => {
    const claudeResponse = {
      content: [
        { type: "text", text: "Answer here." },
        { type: "thinking", thinking: "Consider options." },
        { type: "tool_use", name: "bash", input: { command: "ls -la" } },
      ],
    };
    const chars = countResponseOutputChars(claudeResponse);
    expect(chars).toBeGreaterThan(0);
    const tokens = estimateResponseOutputTokens(claudeResponse);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("Web cookie executor usage calculation", () => {
  it("buildToolCallResponse calculates non-zero prompt and completion tokens", () => {
    const body = {
      messages: [{ role: "user", content: "What is the weather in Tokyo?" }],
    };
    const res = buildToolCallResponse({
      id: "test-call",
      model: "gemini-3.8-flash",
      messageText: "Checking the weather...",
      calls: [{ name: "get_weather", arguments: { city: "Tokyo" } }],
      reasoningContent: "I need to call get_weather",
      body,
    });

    expect(res.usage).toBeDefined();
    expect(res.usage.prompt_tokens).toBeGreaterThan(0);
    expect(res.usage.completion_tokens).toBeGreaterThan(0);
    expect(res.usage.total_tokens).toBe(res.usage.prompt_tokens + res.usage.completion_tokens);
  });
});

describe("chatCore handlers usage recovery", () => {
  it("handleNonStreamingResponse estimates completion tokens when provider returns 0 tokens", async () => {
    mocks.saveRequestUsage.mockClear();

    const providerResponse = new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1234567890,
        model: "gemini-3.8-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "This is a detailed response from Gemini Web." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const body = {
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "Tell me a story" }],
    };

    const res = await handleNonStreamingResponse({
      providerResponse,
      provider: "gemini-web",
      model: "gemini-3.8-flash",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body,
      stream: false,
      requestStartTime: Date.now(),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });

    expect(res.success).toBe(true);
    expect(mocks.saveRequestUsage).toHaveBeenCalled();
    const lastCall = mocks.saveRequestUsage.mock.calls[0][0];
    expect(lastCall.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(lastCall.tokens.completion_tokens).toBeGreaterThan(0);
  });

  it("buildOnStreamComplete estimates completion tokens when stream had content but 0 completion tokens", async () => {
    mocks.saveRequestUsage.mockClear();

    const { onStreamComplete } = buildOnStreamComplete({
      provider: "gemini-web",
      model: "gemini-3.8-flash",
      requestStartTime: Date.now(),
      body: { messages: [{ role: "user", content: "Stream me something" }] },
      stream: true,
    });

    // Simulate stream finishing with prompt_tokens 2000 (e.g. from buffer) but 0 completion tokens
    onStreamComplete(
      { content: "Here is streamed output from web cookie provider.", totalContentLength: 48 },
      { prompt_tokens: 2000, completion_tokens: 0, total_tokens: 2000 },
      Date.now()
    );

    expect(mocks.saveRequestUsage).toHaveBeenCalled();
    const saved = mocks.saveRequestUsage.mock.calls[0][0];
    expect(saved.tokens.prompt_tokens).toBe(2000);
    expect(saved.tokens.completion_tokens).toBeGreaterThan(0);
    expect(saved.tokens.total_tokens).toBe(2000 + saved.tokens.completion_tokens);
  });
});
