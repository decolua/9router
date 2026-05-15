import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";

const originalFetch = global.fetch;

describe("MiniMax TTS", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends MiniMax T2A payload and converts hex audio to base64 JSON", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { audio: "00010203", status: 2 },
          extra_info: { audio_format: "mp3" },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleTtsCore({
      provider: "minimax",
      model: "speech-2.8-hd/English_expressive_narrator",
      input: "Hello from MiniMax",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.minimax.io/v1/t2a_v2",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
      })
    );

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      model: "speech-2.8-hd",
      text: "Hello from MiniMax",
      stream: false,
      language_boost: "auto",
      output_format: "hex",
      voice_setting: {
        voice_id: "English_expressive_narrator",
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    });

    const body = await result.response.json();
    expect(body).toEqual({ audio: "AAECAw==", format: "mp3" });
  });

  it("uses the default MiniMax voice when no voice is provided", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { audio: "00010203", status: 2 },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleTtsCore({
      provider: "minimax-cn",
      model: "speech-2.8-turbo",
      input: "Hello",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.minimaxi.com/v1/t2a_v2");

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("speech-2.8-turbo");
    expect(sent.voice_setting.voice_id).toBe("English_expressive_narrator");
  });

  it("surfaces MiniMax base_resp errors", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          base_resp: { status_code: 1008, status_msg: "insufficient quota" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleTtsCore({
      provider: "minimax",
      model: "speech-2.8-hd/English_expressive_narrator",
      input: "Hello",
      credentials: { apiKey: "test-key" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("insufficient quota");
  });
});
