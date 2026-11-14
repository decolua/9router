import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore, fetchElevenLabsModels } from "../../open-sse/handlers/ttsCore.js";
import { buildTtsProviderModels } from "../../open-sse/config/ttsModels.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const originalFetch = global.fetch;
const AUDIO = Buffer.alloc(2048, 1);

function mockAudio() {
  global.fetch.mockResolvedValueOnce(new Response(AUDIO, { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
}

async function synth(extra = {}) {
  mockAudio();
  const result = await handleTtsCore({
    provider: "elevenlabs",
    model: "eleven_v4/voice123",
    input: "Hello",
    credentials: { apiKey: "test-key" },
    ...extra,
  });
  const [url, init] = global.fetch.mock.calls[0];
  return { result, url: new URL(url), init, sent: JSON.parse(init.body) };
}

describe("ElevenLabs TTS", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("offers current models and not deprecated ones", () => {
    const ids = buildTtsProviderModels()["elevenlabs-tts-models"].map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["eleven_v4", "eleven_v4_turbo", "eleven_flash_v2_5", "eleven_multilingual_v2"]));
    expect(ids).not.toContain("eleven_turbo_v2_5");
    expect(ids).not.toContain("eleven_monolingual_v1");
  });

  it("registers scribe_v3 for STT", () => {
    expect(PROVIDER_MODELS.el.map((m) => m.id)).toContain("scribe_v3");
  });

  it("sends model_id and voice, and does not force voice_settings", async () => {
    const { result, url, init, sent } = await synth();
    expect(result.success).toBe(true);
    expect(url.pathname).toBe("/v1/text-to-speech/voice123");
    expect(url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(init.headers["xi-api-key"]).toBe("test-key");
    expect(sent).toEqual({ text: "Hello", model_id: "eleven_v4" });
  });

  it("falls back to flash v2.5 when only a voice id is given", async () => {
    const { sent, url } = await synth({ model: "voice123" });
    expect(sent.model_id).toBe("eleven_flash_v2_5");
    expect(url.pathname).toBe("/v1/text-to-speech/voice123");
  });

  it.each([
    ["opus", "opus_48000_128", "audio/opus"],
    ["wav", "wav_24000", "audio/wav"],
    ["pcm", "pcm_24000", "audio/pcm"],
    ["json", "mp3_44100_128", "application/json"],
  ])("maps response_format %s to output_format %s", async (fmt, param, contentType) => {
    const { result, url } = await synth({ responseFormat: fmt });
    expect(url.searchParams.get("output_format")).toBe(param);
    expect(result.response.headers.get("Content-Type")).toBe(contentType);
  });

  it("maps language to language_code", async () => {
    const { sent } = await synth({ language: "ja" });
    expect(sent.language_code).toBe("ja");
  });

  it("passes only whitelisted ElevenLabs fields through", async () => {
    const { sent } = await synth({
      options: {
        model: "ignored",
        input: "ignored",
        voice_settings: { speed: 1.1, stability: 0.3 },
        seed: 7,
        apply_text_normalization: "on",
        previous_text: "Before",
      },
    });
    expect(sent).toEqual({
      text: "Hello",
      model_id: "eleven_v4",
      voice_settings: { speed: 1.1, stability: 0.3 },
      seed: 7,
      apply_text_normalization: "on",
      previous_text: "Before",
    });
  });

  it("surfaces the ElevenLabs error message", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { message: "bad voice" } }), { status: 400 })
    );
    const result = await handleTtsCore({
      provider: "elevenlabs", model: "eleven_v4/x", input: "Hello", credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("bad voice");
  });
});

describe("ElevenLabs live model list", () => {
  const apiModels = [
    { model_id: "eleven_v4", name: "Eleven v4", can_do_text_to_speech: true },
    { model_id: "eleven_multilingual_sts_v2", name: "STS", can_do_text_to_speech: false },
    { model_id: "eleven_alpha", name: "Alpha", can_do_text_to_speech: true, requires_alpha_access: true },
    { model_id: "eleven_flash_v2_5", can_do_text_to_speech: true },
  ];

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("keeps usable TTS models, authenticates, and caches per key", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify(apiModels), { status: 200 }));
    const models = await fetchElevenLabsModels("live-key-1");
    expect(models).toEqual([
      { id: "eleven_v4", name: "Eleven v4", type: "tts" },
      { id: "eleven_flash_v2_5", name: "eleven_flash_v2_5", type: "tts" },
    ]);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.elevenlabs.io/v1/models");
    expect(global.fetch.mock.calls[0][1].headers["xi-api-key"]).toBe("live-key-1");

    await fetchElevenLabsModels("live-key-1");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("requires a key and throws on upstream errors", async () => {
    await expect(fetchElevenLabsModels("")).rejects.toThrow("API key required");
    global.fetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(fetchElevenLabsModels("bad-key")).rejects.toThrow("401");
  });
});
