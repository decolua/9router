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
      { id: "eleven_flash_v2_5",      name: "Flash v2.5 (Fastest)",      type: "tts" },
      { id: "eleven_turbo_v2_5",      name: "Turbo v2.5 (Fast)",         type: "tts" },
      { id: "eleven_multilingual_v2", name: "Multilingual v2 (Quality)",  type: "tts" },
      { id: "eleven_monolingual_v1",  name: "Monolingual v1 (English)",  type: "tts" },
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
