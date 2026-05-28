import { describe, expect, it, vi } from "vitest";

vi.mock("@/sse/handlers/chat.js", () => ({
  handleChat: vi.fn(),
}));

vi.mock("open-sse/translator/index.js", () => ({
  initTranslators: vi.fn(),
}));

import { transformOpenAISSEToGeminiSSE } from "../../src/app/api/v1beta/models/[...path]/route.js";

function createSseResponse(chunks) {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

async function readSseJson(response) {
  const text = await response.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
}

describe("Gemini v1beta SSE buffering", () => {
  it("parses JSON data lines split across chunks without dropping tokens", async () => {
    const firstLine =
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n';
    const secondLine =
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n';
    const finalLine =
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3},"model":"test-model"}';

    const response = transformOpenAISSEToGeminiSSE(
      createSseResponse([
        firstLine.slice(0, 18),
        firstLine.slice(18) + secondLine.slice(0, 23),
        secondLine.slice(23) + finalLine.slice(0, 35),
        finalLine.slice(35),
      ]),
      "fallback-model",
    );

    const chunks = await readSseJson(response);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].candidates[0].content.parts[0].text).toBe("Hel");
    expect(chunks[1].candidates[0].content.parts[0].text).toBe("lo");
    expect(chunks[2].candidates[0].finishReason).toBe("STOP");
    expect(chunks[2].usageMetadata).toEqual({
      promptTokenCount: 1,
      candidatesTokenCount: 2,
      totalTokenCount: 3,
    });
    expect(chunks[2].modelVersion).toBe("test-model");
  });
});
