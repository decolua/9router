import { GOOGLE_TTS_LANGUAGES } from "./googleTtsLanguages.js";

// ── Voice definitions (DRY — reused across providers) ──────────────────────
const VOICES = {
  alloy:   { id: "alloy",   name: "Alloy" },
  ash:     { id: "ash",     name: "Ash" },
  ballad:  { id: "ballad",  name: "Ballad" },
  cedar:   { id: "cedar",   name: "Cedar" },
  coral:   { id: "coral",   name: "Coral" },
  echo:    { id: "echo",    name: "Echo" },
  fable:   { id: "fable",   name: "Fable" },
  marin:   { id: "marin",   name: "Marin" },
  nova:    { id: "nova",    name: "Nova" },
  onyx:    { id: "onyx",    name: "Onyx" },
  sage:    { id: "sage",    name: "Sage" },
  shimmer: { id: "shimmer", name: "Shimmer" },
  verse:   { id: "verse",   name: "Verse" },
};

const v = (...keys) => keys.map((k) => ({ ...VOICES[k], type: "tts" }));

// 9 voices for tts-1 / tts-1-hd
const VOICES_STANDARD = v("alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer");
// 13 voices for gpt-4o-mini-tts
const VOICES_FULL = v("alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse");

// Gemini prebuilt voices (30 voices, multi-language auto-detect)
const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((id) => ({ id, name: id, type: "tts" }));

// Xiaomi MiMo preset voices (from https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5).
// Voice id is passed via `audio.voice`; `mimo_default` = default (冰糖 on CN cluster, Mia elsewhere).
// Voices are language-independent — the spoken language is a separate hint, not bound to the voice.
const MIMO_VOICES = [
  { id: "mimo_default", name: "mimo_default" },
  { id: "冰糖",           name: "冰糖" },
  { id: "茉莉",           name: "茉莉" },
  { id: "苏打",           name: "苏打" },
  { id: "白桦",           name: "白桦" },
  { id: "Mia",           name: "Mia" },
  { id: "Chloe",         name: "Chloe" },
  { id: "Milo",          name: "Milo" },
  { id: "Dean",          name: "Dean" },
].map((v) => ({ type: "tts", ...v }));

// Per-model ElevenLabs capabilities, shared by the adapter and the dashboard
// panel so the two can't drift apart. One row per model — adding a model means
// adding one line here, not editing three parallel tables.
//
//   langCode — accepts `language_code`. Verified against the live API:
//     eleven_multilingual_v2 answers 400 unsupported_language ("Model
//     'eleven_multilingual_v2' does not support language_code 'vi'"), while v3,
//     flash_v2_5 and turbo_v2_5 all return audio.
//   classic  — accepts the classic voice_settings knobs. Per the docs, "speed,
//     similarity, and Speaker Boost settings are not available for the Eleven v3
//     model" — v3 is directed with audio tags and stability instead.
//   maxChars — /v1/models maximum_text_length_per_request.
export const ELEVEN_MODELS = {
  eleven_v3:              { maxChars: 5000,  langCode: true,  classic: false },
  eleven_multilingual_v2: { maxChars: 10000, langCode: false, classic: true  },
  eleven_flash_v2_5:      { maxChars: 40000, langCode: true,  classic: true  },
  eleven_turbo_v2_5:      { maxChars: 40000, langCode: true,  classic: true  },
};

// Unknown model → assume the most restrictive shape rather than sending fields
// the upstream may reject.
const ELEVEN_MODEL_FALLBACK = { maxChars: 5000, langCode: false, classic: false };

export const elevenModel = (id) => ELEVEN_MODELS[id] || ELEVEN_MODEL_FALLBACK;

// ElevenLabs output_format values, as codec_samplerate_bitrate. The default is
// mp3_44100_128; higher mp3 bitrates and PCM need a paid plan, and µ-law exists
// for telephony (Twilio) rather than listening. `container` is declared rather
// than parsed back out of the id, so the response is labelled from data.
export const ELEVEN_OUTPUT_FORMATS = [
  { id: "mp3_44100_128", name: "MP3 128 kbps (default)", container: "mp3" },
  { id: "mp3_44100_192", name: "MP3 192 kbps (Creator+)", container: "mp3" },
  { id: "mp3_22050_32", name: "MP3 32 kbps (smallest)", container: "mp3" },
  { id: "pcm_44100", name: "PCM 44.1 kHz (Pro+)", container: "pcm" },
  { id: "pcm_16000", name: "PCM 16 kHz", container: "pcm" },
  { id: "ulaw_8000", name: "µ-law 8 kHz (telephony)", container: "ulaw" },
];

export const elevenContainer = (outputFormatId) =>
  ELEVEN_OUTPUT_FORMATS.find((f) => f.id === outputFormatId)?.container || "mp3";

// ── TTS Config (config-driven, single source of truth) ─────────────────────
export const TTS_MODELS_CONFIG = {
  openai: {
    models: [
      { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
      { id: "tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
      { id: "tts-1",           name: "TTS-1",           type: "tts" },
    ],
    voices: {
      "gpt-4o-mini-tts": VOICES_FULL,
      "tts-1":           VOICES_STANDARD,
      "tts-1-hd":        VOICES_STANDARD,
    },
    // Flat voice list (all unique voices) for backward compat
    allVoices: VOICES_FULL,
  },
  openrouter: {
    models: [
      { id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
      { id: "openai/tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
      { id: "openai/tts-1",           name: "TTS-1",           type: "tts" },
    ],
    voices: {
      "openai/gpt-4o-mini-tts": VOICES_FULL,
      "openai/tts-1":           VOICES_STANDARD,
      "openai/tts-1-hd":        VOICES_STANDARD,
    },
    allVoices: VOICES_FULL,
  },
  elevenlabs: {
    models: [
      { id: "eleven_v3",              name: "Eleven v3 (Most Expressive · 70+ langs)", type: "tts" },
      { id: "eleven_multilingual_v2", name: "Multilingual v2 (Quality)",  type: "tts" },
      { id: "eleven_flash_v2_5",      name: "Flash v2.5 (Fastest)",      type: "tts" },
      { id: "eleven_turbo_v2_5",      name: "Turbo v2.5 (Fast)",         type: "tts" },
      // eleven_monolingual_v1 removed: the API now rejects it with
      // "the models eleven_monolingual_v1 and eleven_multilingual_v1 have been
      // deprecated and are no longer available", so offering it only produces a 400.
    ],
    // voices come from API, not hardcoded
  },
  "edge-tts": {
    defaults: [
      { id: "en-US-AriaNeural",    name: "Aria (en-US)",    type: "tts" },
      { id: "en-US-GuyNeural",     name: "Guy (en-US)",     type: "tts" },
      { id: "en-GB-SoniaNeural",   name: "Sonia (en-GB)",   type: "tts" },
      { id: "vi-VN-HoaiMyNeural",  name: "Hoai My (vi-VN)", type: "tts" },
      { id: "vi-VN-NamMinhNeural", name: "Nam Minh (vi-VN)", type: "tts" },
      { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao (zh-CN)", type: "tts" },
      { id: "zh-CN-YunxiNeural",   name: "Yunxi (zh-CN)",   type: "tts" },
      { id: "fr-FR-DeniseNeural",  name: "Denise (fr-FR)",  type: "tts" },
      { id: "de-DE-KatjaNeural",   name: "Katja (de-DE)",   type: "tts" },
      { id: "ja-JP-NanamiNeural",  name: "Nanami (ja-JP)",  type: "tts" },
      { id: "ko-KR-SunHiNeural",   name: "SunHi (ko-KR)",   type: "tts" },
    ],
  },
  "local-device": {
    defaults: [
      { id: "default", name: "System Default Voice", type: "tts" },
    ],
  },
  "google-tts": {
    defaults: GOOGLE_TTS_LANGUAGES,
  },
  gemini: {
    models: [
      { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", type: "tts" },
      { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS", type: "tts" },
      { id: "gemini-2.5-pro-preview-tts",   name: "Gemini 2.5 Pro TTS",   type: "tts" },
    ],
    voices: {
      "gemini-3.1-flash-tts-preview": GEMINI_VOICES,
      "gemini-2.5-flash-preview-tts": GEMINI_VOICES,
      "gemini-2.5-pro-preview-tts":   GEMINI_VOICES,
    },
    allVoices: GEMINI_VOICES,
  },
  "xiaomi-mimo": {
    models: [
      { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", type: "tts" },
    ],
    voices: {
      "mimo-v2.5-tts": MIMO_VOICES,
    },
  },
};

// ── Helper: get voices for a specific model ────────────────────────────────
export function getTtsVoicesForModel(provider, modelId) {
  const cfg = TTS_MODELS_CONFIG[provider];
  if (!cfg?.voices) return null;
  return cfg.voices[modelId] || cfg.allVoices || null;
}

// ── Build flat entries for PROVIDER_MODELS backward compat ─────────────────
export function buildTtsProviderModels() {
  const entries = {};
  for (const [provider, cfg] of Object.entries(TTS_MODELS_CONFIG)) {
    if (cfg.models) entries[`${provider}-tts-models`] = cfg.models;
    if (cfg.allVoices) entries[`${provider}-tts-voices`] = cfg.allVoices;
    if (cfg.defaults) entries[provider] = cfg.defaults;
  }
  // Keep openai-tts-voices key pointing to full voice list for backward compat
  entries["openai-tts-voices"] = TTS_MODELS_CONFIG.openai.allVoices;
  entries["openrouter-tts-voices"] = TTS_MODELS_CONFIG.openrouter.allVoices;
  return entries;
}
