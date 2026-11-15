import { describe, it, expect, vi, afterEach } from "vitest";
import { handleSttCore } from "open-sse/handlers/sttCore.js";

describe("STT multipart FormData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds OpenAI-compatible multipart payload with file and model", async () => {
    let capturedBody = null;
    vi.stubGlobal("fetch", async (url, opts) => {
      capturedBody = opts.body;
      return new Response(JSON.stringify({ text: "transcribed speech" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("file", new File([new Uint8Array([0, 1, 2])], "audio.wav", { type: "audio/wav" }));
    form.set("language", "uk");

    const result = await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: form,
      credentials: { apiKey: "test-key" },
      sttConfig: {
        baseUrl: "https://api.openai.com/v1/audio/transcriptions",
        authType: "bearer",
        format: "openai",
      },
    });

    expect(result.success).toBe(true);
    expect(capturedBody).toBeDefined();
    expect(capturedBody.get("model")).toBe("whisper-1");
    expect(capturedBody.get("language")).toBe("uk");
    const filePart = capturedBody.get("file");
    expect(filePart).toBeDefined();
    expect(filePart.name).toBe("audio.wav");
  });
});
