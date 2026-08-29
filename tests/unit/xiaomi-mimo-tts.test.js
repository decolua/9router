import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { buildTtsProviderModels, getTtsVoicesForModel } from "../../open-sse/config/ttsModels.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { TTS_PROVIDER_CONFIG } from "../../src/shared/constants/ttsProviders.js";

const originalFetch = global.fetch;

function mockMiMoAudioResponse() {
  global.fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              audio: {
                data: Buffer.from([0, 1, 2, 3]).toString("base64"),
                format: "wav",
                transcript: "Hello from MiMo",
              },
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
}

describe("Xiaomi MiMo TTS", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to chat completions with text as assistant message and voice in audio.voice", async () => {
    mockMiMoAudioResponse();

    const result = await handleTtsCore({
      provider: "xiaomi-mimo",
      model: "mimo-v2.5-tts/冰糖",
      input: "Hello from MiMo",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("mimo-v2.5-tts");
    expect(sent.stream).toBe(false);
    expect(sent.audio.format).toBe("wav");
    expect(sent.audio.voice).toBe("冰糖");
    const assistant = sent.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("Hello from MiMo");

    const body = await result.response.json();
    expect(body.format).toBe("wav");
    expect(body.audio).toEqual(expect.any(String));
  });

  it("uses mimo_default when no voice is provided", async () => {
    mockMiMoAudioResponse();

    await handleTtsCore({
      provider: "xiaomi-mimo",
      model: "mimo-v2.5-tts",
      input: "Hello from MiMo",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("mimo-v2.5-tts");
    expect(sent.audio.voice).toBe("mimo_default");
  });

  it("threads the style field into the role:user message", async () => {
    mockMiMoAudioResponse();

    await handleTtsCore({
      provider: "xiaomi-mimo",
      model: "mimo-v2.5-tts/Chloe",
      input: "Hello from MiMo",
      style: "a calm, warm female voice speaking slowly",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    const user = sent.messages.find((m) => m.role === "user");
    expect(user.content).toBe("a calm, warm female voice speaking slowly");
  });

  it("exposes MiMo TTS models + preset voices in the TTS catalog", () => {
    const entries = buildTtsProviderModels();

    expect(entries["xiaomi-mimo-tts-models"].map((model) => model.id)).toEqual(["mimo-v2.5-tts"]);

    const voices = getTtsVoicesForModel("xiaomi-mimo", "mimo-v2.5-tts");
    expect(voices.map((v) => v.id)).toEqual([
      "mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean",
    ]);
    expect(voices.find((v) => v.id === "冰糖")).toMatchObject({ name: "冰糖" });
    expect(voices.find((v) => v.id === "Dean")).toMatchObject({ name: "Dean" });
    // Voices are language-independent and gender-neutral (no language/gender labels in the UI)
    expect(voices[0]).not.toHaveProperty("language");
    expect(voices[0]).not.toHaveProperty("gender");
    expect(getTtsVoicesForModel("xiaomi-mimo", "mimo-v2.5-tts-voiceclone")).toBeNull();
  });

  it("threads the language hint into a role:user instruction", async () => {
    mockMiMoAudioResponse();

    await handleTtsCore({
      provider: "xiaomi-mimo",
      model: "mimo-v2.5-tts/冰糖",
      input: "Hello from MiMo",
      language: "English",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    const user = sent.messages.find((m) => m.role === "user");
    expect(user.content).toBe("Speak in English.");
  });

  it("wires the provider into media-providers TTS (serviceKind, adapter, UI config)", () => {
    expect(AI_PROVIDERS["xiaomi-mimo"].serviceKinds).toContain("tts");
    expect(AI_PROVIDERS["xiaomi-mimo"].ttsConfig.baseUrl).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(getTtsAdapter("xiaomi-mimo")).toBeTruthy();

    const ttsModels = PROVIDER_MODELS["xiaomi-mimo"].filter((m) => (m.kind || m.type) === "tts").map((m) => m.id);
    expect(ttsModels).toEqual(["mimo-v2.5-tts"]);

    expect(TTS_PROVIDER_CONFIG["xiaomi-mimo"].hasStyleInput).toBe(true);
    expect(TTS_PROVIDER_CONFIG["xiaomi-mimo"].hasLanguageHint).toBe(true);
    expect(TTS_PROVIDER_CONFIG["xiaomi-mimo"].languageOptions).toEqual(["Chinese", "English"]);
    expect(TTS_PROVIDER_CONFIG["xiaomi-mimo"].hasVoiceIdInput).toBe(false);
  });
});
