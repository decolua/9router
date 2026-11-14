// ElevenLabs TTS — voice id with optional model_id prefix
import { Buffer } from "node:buffer";

const VOICES_TTL = 24 * 60 * 60 * 1000;
const _voicesCache = new Map(); // by API key

export async function fetchElevenLabsVoices(apiKey) {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  const now = Date.now();
  const cached = _voicesCache.get(apiKey);
  if (cached && now - cached.time < VOICES_TTL) return cached.voices;

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices fetch failed: ${res.status}`);
  const data = await res.json();
  // Normalize: derive lang from labels for grouping
  const voices = (data.voices || []).map((v) => ({ ...v, lang: v.labels?.language || "en" }));
  _voicesCache.set(apiKey, { voices, time: now });
  return voices;
}

const MODELS_TTL = 24 * 60 * 60 * 1000;
const _modelsCache = new Map(); // by API key

// Live TTS model list for this account (GET /v1/models needs a key). New ElevenLabs
// models appear here without a 9Router release; callers fall back to the static list.
export async function fetchElevenLabsModels(apiKey) {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  const now = Date.now();
  const cached = _modelsCache.get(apiKey);
  if (cached && now - cached.time < MODELS_TTL) return cached.models;

  const res = await fetch("https://api.elevenlabs.io/v1/models", { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs models fetch failed: ${res.status}`);
  const models = (await res.json())
    .filter((m) => m.can_do_text_to_speech && !m.requires_alpha_access)
    .map((m) => ({ id: m.model_id, name: m.name || m.model_id, type: "tts" }));
  _modelsCache.set(apiKey, { models, time: now });
  return models;
}

// OpenAI-style response_format → ElevenLabs output_format. PCM/WAV at 24 kHz match
// OpenAI's `pcm` and stay available below the Pro tier (44.1 kHz is Pro-only).
const OUTPUT_FORMATS = {
  mp3: { param: "mp3_44100_128", format: "mp3" },
  opus: { param: "opus_48000_128", format: "opus" },
  wav: { param: "wav_24000", format: "wav" },
  pcm: { param: "pcm_24000", format: "pcm" },
};

// ElevenLabs-native request fields a client may pass through on /v1/audio/speech.
// Anything omitted keeps the voice's own stored settings (nothing is forced here).
const PASSTHROUGH_FIELDS = [
  "voice_settings",
  "seed",
  "apply_text_normalization",
  "previous_text",
  "next_text",
  "pronunciation_dictionary_locators",
];

export default {
  async synthesize(text, model, credentials, responseFormat, { language, options } = {}) {
    if (!credentials?.apiKey) throw new Error("ElevenLabs API key required");
    let modelId = "eleven_flash_v2_5";
    let voiceId = model;
    if (model && model.includes("/")) [modelId, voiceId] = model.split("/");

    // response_format "json" is the router's base64 envelope, not a codec → mp3.
    const out = OUTPUT_FORMATS[responseFormat] || OUTPUT_FORMATS.mp3;

    const body = { text, model_id: modelId };
    if (language) body.language_code = language;
    for (const key of PASSTHROUGH_FIELDS) {
      if (options?.[key] !== undefined) body[key] = options[key];
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${out.param}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": credentials.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail?.message || `ElevenLabs TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error("ElevenLabs TTS returned empty audio");
    return { base64: Buffer.from(buf).toString("base64"), format: out.format };
  },
};
