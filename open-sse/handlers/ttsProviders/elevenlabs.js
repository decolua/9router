// ElevenLabs TTS — voice id with optional model_id prefix
import { Buffer } from "node:buffer";
import { ELEVENLABS_DEFAULT_VOICES, ELEVENLABS_DEFAULT_VOICE_ID } from "../../config/elevenlabsVoices.js";
import { TTS_MODELS_CONFIG, elevenModel, elevenContainer } from "../../config/ttsModels.js";
import { parseModelVoice } from "./_base.js";

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

  // The entry is stale (or absent) from here on — drop it so a key that is
  // rotated away stops occupying the map for the process lifetime.
  _voicesCache.delete(apiKey);
  const cacheFallbackRoster = () => {
    _voicesCache.set(apiKey, { voices: ELEVENLABS_DEFAULT_VOICES, time: now, isFallback: true });
    return ELEVENLABS_DEFAULT_VOICES;
  };

  let res;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    });
  } catch {
    // Network failure — fall back to curated defaults so the picker still works.
    // Cached like the 401 path, so an upstream outage costs one full-timeout
    // fetch per FALLBACK_TTL rather than one per picker open.
    return cacheFallbackRoster();
  }

  if (!res.ok) {
    // Restricted keys may grant text_to_speech without voices_read (401), and
    // some plans gate voice listing. Fall back to the curated default roster so
    // the integration keeps working instead of presenting an empty picker.
    if (res.status === 401 || res.status === 403) return cacheFallbackRoster();
    throw new Error(`ElevenLabs voices fetch failed: ${res.status}`);
  }

  const data = await res.json();
  // Normalize: derive lang from labels for grouping
  const voices = (data.voices || []).map((v) => ({ ...v, lang: v.labels?.language || "en" }));
  _voicesCache.set(apiKey, { voices, time: now });
  return voices;
}

const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const ELEVEN_MODEL_LIST = TTS_MODELS_CONFIG.elevenlabs.models;
// Anything under this is a truncated/empty upstream body rather than audio.
const MIN_AUDIO_BYTES = 1024;

export default {
  async synthesize(text, model, credentials, _responseFormat, opts = {}) {
    if (!credentials?.apiKey) throw new Error("ElevenLabs API key required");
    // Stability (Eleven v3: 0=Creative, 0.5=Natural, 1=Robust). Default Natural.
    const stability = typeof opts.stability === "number" ? opts.stability : 0.5;
    // Optional language override (ISO 639-1, e.g. "vi"). Empty = model auto-detects.
    const languageCode = typeof opts.languageCode === "string" ? opts.languageCode.trim() : "";
    // Playback rate, clamped to the range the API accepts.
    const speed = typeof opts.speed === "number" ? Math.min(1.2, Math.max(0.7, opts.speed)) : undefined;
    const outputFormat = typeof opts.outputFormat === "string" ? opts.outputFormat.trim() : "";

    // Shared parser: matches against the known model list (longest prefix wins)
    // rather than betting on the "eleven_" naming convention, so a future model
    // id that breaks the convention is not mistaken for a voice id.
    // The default voice is applied AFTER parsing, not passed in as the parser's
    // fallback — passing it would make a bare voice id resolve to the default.
    const { modelId, voiceId: parsedVoiceId } = parseModelVoice(model, DEFAULT_MODEL_ID, "", ELEVEN_MODEL_LIST);
    const voiceId = parsedVoiceId || ELEVENLABS_DEFAULT_VOICE_ID;

    // similarity_boost and speed are documented as unavailable on Eleven v3, which
    // is steered by audio tags and stability instead — sending them there is noise.
    const caps = elevenModel(modelId);
    const query = outputFormat ? `?output_format=${encodeURIComponent(outputFormat)}` : "";

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}${query}`, {
      method: "POST",
      headers: { "xi-api-key": credentials.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          ...(caps.classic ? { similarity_boost: 0.75 } : {}),
          ...(caps.classic && speed !== undefined ? { speed } : {}),
        },
        // Only models that declare langCode accept language_code; multilingual_v2
        // answers 400 unsupported_language, so drop the field rather than fail
        // the whole synthesis over an optional hint.
        ...(languageCode && caps.langCode ? { language_code: languageCode } : {}),
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
    if (buf.byteLength < MIN_AUDIO_BYTES) throw new Error("ElevenLabs TTS returned empty audio");
    // The container comes from the requested output_format's declared `container`
    // rather than Content-Type sniffing: the request states the codec exactly, so
    // labelling from it can't mislabel PCM or µ-law as mp3.
    return { base64: Buffer.from(buf).toString("base64"), format: elevenContainer(outputFormat) };
  },
};
