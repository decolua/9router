import { describe, it, expect, vi } from "vitest";

// Mock SQLite kv store for thoughtSignatureStore
vi.mock("@/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    getAll: async () => ({
      "persisted_call_1": {
        signature: "PERSISTED_SIG_123",
        family: "gemini",
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000000,
      }
    }),
  }),
}));

const {
  convertOpenAIContentToParts,
} = await import("../../open-sse/translator/formats/gemini.js");

const {
  openaiToAntigravityRequest,
  openaiToGeminiCLIRequest,
} = await import("../../open-sse/translator/request/openai-to-gemini.js");

const {
  DEFAULT_THINKING_AG_SIGNATURE,
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
} = await import("../../open-sse/config/defaultThinkingSignature.js");

describe("Multimodal inlineData normalization", () => {
  it("normalizes base64 image_url with both camelCase mimeType and snake_case mime_type", () => {
    const parts = convertOpenAIContentToParts([
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
      },
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0].inlineData).toBeDefined();
    expect(parts[0].inlineData.mimeType).toBe("image/jpeg");
    expect(parts[0].inlineData.mime_type).toBe("image/jpeg");
    expect(parts[0].inlineData.data).toBe("/9j/4AAQSkZJRg==");
  });

  it("normalizes input_audio with both mimeType and mime_type", () => {
    const parts = convertOpenAIContentToParts([
      {
        type: "input_audio",
        input_audio: { data: "AUDIODATA", format: "wav" },
      },
    ]);

    expect(parts[0].inlineData).toEqual({
      mimeType: "audio/wav",
      mime_type: "audio/wav",
      data: "AUDIODATA",
    });
  });

  it("preserves multimodal base64 image in wrapInCloudCodeEnvelopeForClaude", () => {
    const req = openaiToAntigravityRequest(
      "claude-opus-5-5",
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this diagram" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
              },
            ],
          },
        ],
      },
      false
    );

    const contents = req.request.contents;
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe("user");

    const imagePart = contents[0].parts.find((p) => p.inlineData);
    expect(imagePart).toBeDefined();
    expect(imagePart.inlineData.mimeType).toBe("image/png");
    expect(imagePart.inlineData.mime_type).toBe("image/png");
    expect(imagePart.inlineData.data).toBe("iVBORw0KGgoAAAANSUhEUg==");
  });
});

describe("Thought signature resilience on long sessions and parallel tool calls", () => {
  it("ensures ALL parallel function calls receive thoughtSignature even without cached signatures", () => {
    const body = {
      messages: [
        { role: "user", content: "perform parallel tasks" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_a", type: "function", function: { name: "tool_one", arguments: "{}" } },
            { id: "call_b", type: "function", function: { name: "tool_two", arguments: "{}" } },
            { id: "call_c", type: "function", function: { name: "tool_three", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_a", content: "res a" },
        { role: "tool", tool_call_id: "call_b", content: "res b" },
        { role: "tool", tool_call_id: "call_c", content: "res c" },
      ],
    };

    const req = openaiToGeminiCLIRequest("gemini-3.8-flash-tiered", body, false);
    const modelTurn = req.contents.find((c) => c.role === "model");
    expect(modelTurn).toBeDefined();

    const functionCalls = modelTurn.parts.filter((p) => p.functionCall);
    expect(functionCalls).toHaveLength(3);

    // Every single parallel function call MUST have thoughtSignature attached
    for (const fc of functionCalls) {
      expect(fc.thoughtSignature).toBeDefined();
      expect(typeof fc.thoughtSignature).toBe("string");
      expect(fc.thoughtSignature.length).toBeGreaterThan(0);
      expect(fc.thoughtSignature).toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
    }
  });

  it("ensures Antigravity Claude requests attach thoughtSignature to all functionCall parts", () => {
    const body = {
      messages: [
        { role: "user", content: "run commands" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "Bash", arguments: '{"command":"ls"}' } },
            { id: "call_2", type: "function", function: { name: "Read", arguments: '{"path":"file.txt"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "file.txt" },
        { role: "tool", tool_call_id: "call_2", content: "content" },
      ],
    };

    const req = openaiToAntigravityRequest("claude-opus-5-5", body, false);
    const modelTurn = req.request.contents.find((c) => c.role === "model");
    expect(modelTurn).toBeDefined();

    const functionCalls = modelTurn.parts.filter((p) => p.functionCall);
    expect(functionCalls).toHaveLength(2);

    for (const fc of functionCalls) {
      expect(fc.thoughtSignature).toBeDefined();
      expect(fc.thoughtSignature).toBe(DEFAULT_THINKING_AG_SIGNATURE);
    }
  });
});
