import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { buildTtsProviderModels, getTtsVoicesForModel } from "../../open-sse/config/ttsModels.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const originalFetch = global.fetch;

function mockOllamaAudioResponse() {
  global.fetch.mockResolvedValueOnce(
    new Response(
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...new Array(100).fill(0)]),
      { status: 200, headers: { "Content-Type": "audio/wav" } }
    )
  );
}

describe("Ollama Local TTS", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to /v1/audio/speech with model, input, voice, and response_format", async () => {
    mockOllamaAudioResponse();

    const result = await handleTtsCore({
      provider: "ollama-local",
      model: "phonon/Zoey",
      input: "Hello from Ollama Phonon",
      credentials: null,
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("http://localhost:11434/v1/audio/speech");
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("phonon");
    expect(sent.voice).toBe("Zoey");
    expect(sent.input).toBe("Hello from Ollama Phonon");
    // Ollama upstream only accepts wav/pcm; format is normalized to wav
    expect(sent.response_format).toBe("wav");

    const body = await result.response.json();
    expect(body.format).toBe("wav");
    expect(body.audio).toEqual(expect.any(String));
  });

  it("uses default voice when only model is provided", async () => {
    mockOllamaAudioResponse();

    await handleTtsCore({
      provider: "ollama-local",
      model: "phonon",
      input: "Testing default voice",
      responseFormat: "mp3",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("phonon");
    expect(sent.voice).toBe("default");
    expect(sent.response_format).toBe("wav");
  });

  it("maps standalone voice name to phonon model when phonon prefix is omitted", async () => {
    mockOllamaAudioResponse();

    await handleTtsCore({
      provider: "ollama-local",
      model: "Zoey",
      input: "Testing standalone voice",
      responseFormat: "wav",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("phonon:multilingual");
    expect(sent.voice).toBe("Zoey");
    expect(sent.response_format).toBe("wav");
  });

  it("resolves custom baseUrl from credentials when configured", async () => {
    mockOllamaAudioResponse();

    await handleTtsCore({
      provider: "ollama-local",
      model: "phonon/Easton",
      input: "Remote Ollama instance",
      credentials: {
        providerSpecificData: {
          baseUrl: "http://192.168.1.100:11434",
        },
        apiKey: "custom-token",
      },
      responseFormat: "wav",
    });

    expect(global.fetch.mock.calls[0][0]).toBe("http://192.168.1.100:11434/v1/audio/speech");
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer custom-token");

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.voice).toBe("Easton");
  });

  it("handles connection failure with informative error message", async () => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    global.fetch.mockRejectedValueOnce(error);

    const result = await handleTtsCore({
      provider: "ollama-local",
      model: "phonon",
      input: "Should fail gracefully",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot connect to Ollama at http://localhost:11434");
    expect(result.error).toContain("ollama serve");
  });

  it("exposes Phonon TTS models + preset voices in the TTS catalog", () => {
    const entries = buildTtsProviderModels();

    const modelIds = entries["ollama-local-tts-models"].map((model) => model.id);
    expect(modelIds).toContain("phonon:latest");
    expect(modelIds).toContain("phonon");
    expect(modelIds).toContain("phonon:multilingual");
    expect(modelIds).toContain("phonon:40m-multilingual");
    expect(modelIds).toContain("phonon:en");
    expect(modelIds).toContain("phonon:31m-en");
    expect(modelIds).toContain("phonon:40m-en");
    expect(modelIds).toContain("phonon:de");
    expect(modelIds).toContain("phonon:40m-de");
    expect(modelIds).toContain("phonon:es");
    expect(modelIds).toContain("phonon:40m-es");
    expect(modelIds).toContain("phonon:fr");
    expect(modelIds).toContain("phonon:40m-fr");
    expect(modelIds).toContain("phonon:pt");
    expect(modelIds).toContain("phonon:40m-pt");

    const englishVoices = getTtsVoicesForModel("ollama-local", "phonon:40m-en");
    expect(englishVoices.length).toBe(38);
    expect(englishVoices.map((v) => v.id)).toContain("default");
    expect(englishVoices.map((v) => v.id)).toContain("Zoey");
    expect(englishVoices.map((v) => v.id)).toContain("Easton");
    expect(englishVoices.map((v) => v.id)).toContain("Freya");
    expect(englishVoices.map((v) => v.id)).toContain("Azgorath");

    const deVoices = getTtsVoicesForModel("ollama-local", "phonon:de");
    expect(deVoices.map((v) => v.id)).toEqual(["default"]);
  });

});
