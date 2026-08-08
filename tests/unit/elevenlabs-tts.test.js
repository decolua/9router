import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The usage handler goes through proxyAwareFetch, not global.fetch — without this
// the usage tests would silently hit the real ElevenLabs API.
// vi.hoisted, because vi.mock is lifted above ordinary const declarations.
const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { ELEVEN_MODELS, TTS_MODELS_CONFIG } from "../../open-sse/config/ttsModels.js";
import { ELEVENLABS_DEFAULT_VOICES, ELEVENLABS_DEFAULT_VOICE_ID } from "../../open-sse/config/elevenlabsVoices.js";
import { getElevenLabsUsage } from "../../open-sse/services/usage/elevenlabs.js";

const originalFetch = global.fetch;
const CREDS = { apiKey: "test-key" };
const VOICE = "pNInz6obpgDQGcFmaJgB";
// Deliberately NOT the default voice: a bare voice id must survive resolution
// rather than be replaced by the default.
const CUSTOM_VOICE = "21m00Tcm4TlvDq8ikWAM";

// Adapter rejects anything under 1KB as empty audio.
const mockAudio = () =>
  global.fetch.mockResolvedValueOnce(
    new Response(new Uint8Array(2048), { status: 200, headers: { "Content-Type": "audio/mpeg" } })
  );

const mockError = (status, detail) =>
  global.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json" } })
  );

const bodyOf = (call = 0) => JSON.parse(global.fetch.mock.calls[call][1].body);
const urlOf = (call = 0) => global.fetch.mock.calls[call][0];

// responseFormat is a core-level arg; everything else is an adapter option.
const speak = (model, { responseFormat, ...options } = {}) =>
  handleTtsCore({ provider: "elevenlabs", model, input: "Hello", credentials: CREDS, responseFormat, options });

describe("ElevenLabs TTS", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  describe("model / voice resolution", () => {
    it("splits a 'modelId/voiceId' pair into the model body field and the URL", async () => {
      mockAudio();
      await speak(`eleven_v3/${VOICE}`);
      expect(urlOf()).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`);
      expect(bodyOf().model_id).toBe("eleven_v3");
    });

    it("treats a known model id as the model and falls back to the default voice", async () => {
      mockAudio();
      await speak("eleven_flash_v2_5");
      expect(bodyOf().model_id).toBe("eleven_flash_v2_5");
      expect(urlOf()).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}`);
    });

    it("treats any other bare value as a voice id and keeps the default model", async () => {
      mockAudio();
      await speak(CUSTOM_VOICE);
      expect(urlOf()).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${CUSTOM_VOICE}`);
      expect(bodyOf().model_id).toBe("eleven_flash_v2_5");
    });
  });

  describe("language_code guard", () => {
    // The API answers 400 unsupported_language for multilingual_v2, so the field
    // must never reach it — see the `langCode` flag in ELEVEN_MODELS.
    it("sends language_code for models that accept it", async () => {
      const langCodeModels = Object.keys(ELEVEN_MODELS).filter((id) => ELEVEN_MODELS[id].langCode);
      expect(langCodeModels.length).toBeGreaterThan(0);
      for (const model of langCodeModels) {
        global.fetch = vi.fn();
        mockAudio();
        await speak(`${model}/${VOICE}`, { languageCode: "vi" });
        expect(bodyOf().language_code, `${model} should forward language_code`).toBe("vi");
      }
    });

    it("omits language_code for eleven_multilingual_v2", async () => {
      mockAudio();
      await speak(`eleven_multilingual_v2/${VOICE}`, { languageCode: "vi" });
      expect(bodyOf()).not.toHaveProperty("language_code");
    });

    it("omits language_code when none was requested", async () => {
      mockAudio();
      await speak(`eleven_v3/${VOICE}`);
      expect(bodyOf()).not.toHaveProperty("language_code");
    });

    it("does not offer a model the API has retired", () => {
      const ids = TTS_MODELS_CONFIG.elevenlabs.models.map((m) => m.id);
      expect(ids).not.toContain("eleven_monolingual_v1");
    });
  });

  describe("voice settings", () => {
    it("defaults stability to 0.5 and forwards an explicit value", async () => {
      mockAudio();
      await speak(`eleven_v3/${VOICE}`);
      expect(bodyOf().voice_settings.stability).toBe(0.5);

      global.fetch = vi.fn();
      mockAudio();
      await speak(`eleven_v3/${VOICE}`, { stability: 0 });
      expect(bodyOf().voice_settings.stability).toBe(0);
    });

    // The docs state speed, similarity and speaker boost are unavailable on v3.
    it("omits similarity_boost and speed on eleven_v3", async () => {
      mockAudio();
      await speak(`eleven_v3/${VOICE}`, { speed: 1.1 });
      const vs = bodyOf().voice_settings;
      expect(vs).not.toHaveProperty("similarity_boost");
      expect(vs).not.toHaveProperty("speed");
    });

    it("sends similarity_boost and speed on classic models", async () => {
      mockAudio();
      await speak(`eleven_multilingual_v2/${VOICE}`, { speed: 1.1 });
      const vs = bodyOf().voice_settings;
      expect(vs.similarity_boost).toBe(0.75);
      expect(vs.speed).toBe(1.1);
    });

    it("clamps speed to the 0.7–1.2 range the API accepts", async () => {
      mockAudio();
      await speak(`eleven_turbo_v2_5/${VOICE}`, { speed: 5 });
      expect(bodyOf().voice_settings.speed).toBe(1.2);

      global.fetch = vi.fn();
      mockAudio();
      await speak(`eleven_turbo_v2_5/${VOICE}`, { speed: 0.1 });
      expect(bodyOf().voice_settings.speed).toBe(0.7);
    });
  });

  describe("output format", () => {
    it("stays on the provider default when none is requested", async () => {
      mockAudio();
      const r = await speak(`eleven_v3/${VOICE}`, { responseFormat: "json" });
      expect(urlOf()).not.toContain("output_format");
      expect(JSON.parse(await r.response.text()).format).toBe("mp3");
    });

    it("passes output_format as a query parameter and labels the audio by codec", async () => {
      mockAudio();
      const r = await speak(`eleven_v3/${VOICE}`, { outputFormat: "pcm_16000", responseFormat: "json" });
      expect(urlOf()).toContain("output_format=pcm_16000");
      expect(JSON.parse(await r.response.text()).format).toBe("pcm");
    });
  });

  describe("error reporting", () => {
    it("explains a 401 as an invalid key or missing permission", async () => {
      mockError(401, { status: "missing_permissions" });
      const r = await speak(`eleven_v3/${VOICE}`);
      expect(r.success).toBeFalsy();
      expect(r.error).toMatch(/invalid|permission/i);
    });

    it("explains a 402 as a voice requiring a paid plan", async () => {
      mockError(402, {});
      const r = await speak(`eleven_v3/${VOICE}`);
      expect(r.error).toMatch(/paid|plan/i);
    });

    it("surfaces the API's own message when it provides one", async () => {
      mockError(400, { message: "Model 'x' does not support language_code 'vi'." });
      const r = await speak(`eleven_v3/${VOICE}`);
      expect(r.error).toContain("does not support language_code");
    });

    it("rejects a suspiciously small audio payload", async () => {
      global.fetch.mockResolvedValueOnce(new Response(new Uint8Array(16), { status: 200 }));
      const r = await speak(`eleven_v3/${VOICE}`);
      expect(r.error).toMatch(/empty audio/i);
    });
  });

  describe("fallback voice roster", () => {
    it("marks free voices via free_users_allowed, not the raw `free` field", () => {
      // The routes read free_users_allowed; a roster exporting only `free`
      // would silently mark every fallback voice as paid.
      for (const v of ELEVENLABS_DEFAULT_VOICES) {
        expect(v).toHaveProperty("free_users_allowed");
        expect(v.free_users_allowed).toBe(v.free);
        expect(v).toHaveProperty("lang");
      }
      expect(ELEVENLABS_DEFAULT_VOICES.some((v) => v.free_users_allowed)).toBe(true);
    });
  });

  describe("usage handler", () => {
    beforeEach(() => proxyAwareFetch.mockReset());

    it("reports remaining characters and the reset date", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ tier: "free", character_count: 2500, character_limit: 10000, next_character_count_reset_unix: 1787443200 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      const { quotas } = await getElevenLabsUsage("test-key");
      const q = Object.values(quotas)[0];
      expect(q.used).toBe(2500);
      expect(q.remaining).toBe(7500);
      expect(q.remainingPercentage).toBe(75);
      expect(q.resetAt).toBe(new Date(1787443200 * 1000).toISOString());
    });

    it("degrades to a message when the key lacks user_read instead of throwing", async () => {
      proxyAwareFetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
      const r = await getElevenLabsUsage("test-key");
      expect(r.quotas).toBeUndefined();
      expect(r.message).toMatch(/user_read/i);
      expect(proxyAwareFetch).toHaveBeenCalledWith(
        "https://api.elevenlabs.io/v1/user/subscription",
        expect.objectContaining({ headers: expect.objectContaining({ "xi-api-key": "test-key" }) }),
        null
      );
    });

    it("reports unlimited when the plan has no character ceiling", async () => {
      proxyAwareFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ tier: "enterprise", character_count: 0, character_limit: 0 }), { status: 200 })
      );
      const q = Object.values((await getElevenLabsUsage("test-key")).quotas)[0];
      expect(q.unlimited).toBe(true);
      expect(q.resetAt).toBeNull();
    });
  });
});
