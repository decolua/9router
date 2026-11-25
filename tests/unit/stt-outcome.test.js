import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

function formData(responseFormat = null) {
  const data = new FormData();
  data.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "audio.wav");
  if (responseFormat) data.append("response_format", responseFormat);
  return data;
}

const cfg = {
  format: "openai",
  baseUrl: "https://stt.example/v1/audio/transcriptions",
  authType: "bearer",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("STT semantic outcome", () => {
  it("accepts an empty schema-valid JSON transcript for silent audio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const result = await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: formData("json"),
      credentials: { apiKey: "key" },
      sttConfig: cfg,
    });

    expect(result.success).toBe(true);
  });

  it("accepts an empty plain-text transcript for silent audio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })));

    const result = await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: formData("text"),
      credentials: { apiKey: "key" },
      sttConfig: cfg,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an HTTP 200 error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "audio rejected" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const result = await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: formData("json"),
      credentials: { apiKey: "key" },
      sttConfig: cfg,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.errorKind).toBe("upstream_payload_error");
  });
});
