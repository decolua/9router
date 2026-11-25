import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";

const originalFetch = global.fetch;

function sse(lines) {
  return new Response(lines.join("\n\n") + "\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("TTS semantic outcome", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects an OpenAI HTTP 200 JSON error body as non-audio", async () => {
    global.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { message: "voice rejected" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));

    const result = await handleTtsCore({
      provider: "openai",
      model: "tts-1/alloy",
      input: "hello",
      credentials: { apiKey: "key" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.errorKind).toBe("upstream_payload_error");
    expect(result.error).toContain("voice rejected");
  });

  it("rejects an OpenRouter error after partial audio", async () => {
    global.fetch.mockResolvedValueOnce(sse([
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: "AQID" } }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ error: { message: "render failed" } })}`,
      "data: [DONE]",
    ]));

    const result = await handleTtsCore({
      provider: "openrouter",
      model: "openai/gpt-4o-mini-tts/alloy",
      input: "hello",
      credentials: { apiKey: "key" },
    });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("upstream_payload_error");
    expect(result.error).toContain("render failed");
  });

  it("rejects an OpenRouter stream without a terminal", async () => {
    global.fetch.mockResolvedValueOnce(sse([
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: "AQID" } }, finish_reason: null }] })}`,
    ]));

    const result = await handleTtsCore({
      provider: "openrouter",
      model: "openai/gpt-4o-mini-tts/alloy",
      input: "hello",
      credentials: { apiKey: "key" },
    });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("upstream_incomplete");
  });

  it("accepts terminal OpenRouter audio", async () => {
    global.fetch.mockResolvedValueOnce(sse([
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: "AQID" } }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ]));

    const result = await handleTtsCore({
      provider: "openrouter",
      model: "openai/gpt-4o-mini-tts/alloy",
      input: "hello",
      credentials: { apiKey: "key" },
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject({ audio: "AQID", format: "wav" });
  });
});
