// ElevenLabs TTS — voice id with optional model_id prefix
import { Buffer } from "node:buffer";
import { ELEVENLABS_DEFAULT_VOICES } from "../../config/elevenlabsVoices.js";
import { ELEVEN_LANGUAGE_CODE_MODELS } from "../../config/ttsModels.js";

const VOICES_TTL = 24 * 60 * 60 * 1000;
// The fallback roster is cached far more briefly than a real listing: it means the
// key currently can't read voices, and that is a state the user is likely fixing
// right now (granting voices_read, upgrading the plan). A long TTL would leave the
// picker stuck on the defaults for a day after they fix it.
const FALLBACK_TTL = 5 * 60 * 1000;
const _voicesCache = new Map(); // by API key

export async function fetchElevenLabsVoices(apiKey) {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  const now = Date.now();
  const cached = _voicesCache.get(apiKey);
  if (cached && now - cached.time < (cached.isFallback ? FALLBACK_TTL : VOICES_TTL)) return cached.voices;

  let res;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    });
  } catch {
    // Network failure — fall back to curated defaults so the picker still works
    return ELEVENLABS_DEFAULT_VOICES;
  }

  if (!res.ok) {
    // Restricted keys may grant text_to_speech without voices_read (401), and
    // some plans gate voice listing. Fall back to the curated default roster so
    // the integration keeps working instead of presenting an empty picker.
    if (res.status === 401 || res.status === 403) {
      _voicesCache.set(apiKey, { voices: ELEVENLABS_DEFAULT_VOICES, time: now, isFallback: true });
      return ELEVENLABS_DEFAULT_VOICES;
    }
    throw new Error(`ElevenLabs voices fetch failed: ${res.status}`);
  }

  const data = await res.json();
  // Normalize: derive lang from labels for grouping
  const voices = (data.voices || []).map((v) => ({ ...v, lang: v.labels?.language || "en" }));
  _voicesCache.set(apiKey, { voices, time: now });
  return voices;
}

// Sensible free default so requests without an explicit voice still work (Adam - Dominant, Firm).
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";

export default {
  async synthesize(text, model, credentials, _responseFormat, opts = {}) {
    if (!credentials?.apiKey) throw new Error("ElevenLabs API key required");
    // Stability (Eleven v3: 0=Creative, 0.5=Natural, 1=Robust). Default Natural.
    const stability = typeof opts.stability === "number" ? opts.stability : 0.5;
    // Optional language override (ISO 639-1, e.g. "vi"). Empty = model auto-detects.
    const languageCode = typeof opts.languageCode === "string" ? opts.languageCode.trim() : "";
    let modelId = DEFAULT_MODEL_ID;
    let voiceId = "";

    if (model?.includes("/")) {
      [modelId, voiceId] = model.split("/");           // "modelId/voiceId"
    } else if (model?.startsWith("eleven_")) {
      modelId = model;                                  // model only → default voice
    } else if (model) {
      voiceId = model;                                  // bare voice id (never starts with "eleven_")
    }

    if (!voiceId) voiceId = DEFAULT_VOICE_ID;

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": credentials.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability, similarity_boost: 0.75 },
        // Only models in the allow-list accept language_code; multilingual_v2
        // answers 400 unsupported_language, so drop the field rather than fail
        // the whole synthesis over an optional hint.
        ...(languageCode && ELEVEN_LANGUAGE_CODE_MODELS.has(modelId) ? { language_code: languageCode } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err?.detail?.message || err?.detail?.status;
      if (res.status === 401) {
        throw new Error(detail || "ElevenLabs key is invalid or lacks the text_to_speech permission");
      }
      if (res.status === 402) {
        throw new Error(detail || `Voice '${voiceId}' requires a paid ElevenLabs plan — pick a Free voice`);
      }
      throw new Error(detail || `ElevenLabs TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error("ElevenLabs TTS returned empty audio");
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
