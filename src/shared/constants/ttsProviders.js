import { ELEVENLABS_DEFAULT_VOICE_ID } from "open-sse/config/elevenlabsVoices.js";

// Dispatched by the TTS panel after a successful generation; the Providers page
// listens so credit counters refresh. Shared so the two sides can't drift.
export const TTS_GENERATED_EVENT = "tts-generated";

// Floor between usage refetches triggered by tab-return. Each one is a live
// upstream API call, and a quota cannot move while the tab is in the background.
export const MIN_USAGE_REFETCH_MS = 60 * 1000;

/**
 * TTS Provider Configuration
 * Centralized config for TTS provider UI behavior
 */
export const TTS_PROVIDER_CONFIG = {
  "google-tts": {
    hasLanguageDropdown: false,
    hasModelSelector: false,
    hasBrowseButton: true,
    voiceSource: "hardcoded", // languages built from providerModels at runtime
  },
  "openai": {
    hasLanguageDropdown: false,
    hasModelSelector: true,
    hasBrowseButton: false,
    voiceSource: "hardcoded",
    modelKey: "openai-tts-models",
    voiceKey: "openai-tts-voices",
    voicesPerModel: true,
  },
  "openrouter": {
    hasLanguageDropdown: false,
    hasModelSelector: true,
    hasBrowseButton: false,
    voiceSource: "hardcoded",
    modelKey: "openrouter-tts-models",
    voiceKey: "openrouter-tts-voices",
    voicesPerModel: true,
  },
  "elevenlabs": {
    hasLanguageDropdown: false,
    hasModelSelector: true,
    hasBrowseButton: true,
    hasVoiceIdInput: true, // allow manual voice id entry
    voiceSource: "api-language", // grouped by language from backend
    modelKey: "elevenlabs-tts-models",
    apiEndpoint: "/api/media-providers/tts/elevenlabs/voices",
    defaultVoiceId: ELEVENLABS_DEFAULT_VOICE_ID, // same default the adapter uses server-side
  },
  "edge-tts": {
    hasLanguageDropdown: false,
    hasModelSelector: false,
    hasBrowseButton: true,
    voiceSource: "api-language", // from API with language picker
  },
  "local-device": {
    hasLanguageDropdown: false,
    hasModelSelector: false,
    hasBrowseButton: true,
    voiceSource: "api-language", // from API with language picker
  },
  // ── Config-driven providers (load models from providers.js → ttsConfig.models) ──
  "nvidia": {
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: true,
    voiceSource: "config",
  },
  "hyperbolic": {
    hasModelSelector: true,
    hasBrowseButton: false,
    voiceSource: "config",
  },
  "deepgram": {
    hasModelSelector: false,
    hasBrowseButton: true,
    voiceSource: "api-language",
    apiEndpoint: "/api/media-providers/tts/deepgram/voices",
  },
  "huggingface": {
    hasModelSelector: true,
    hasBrowseButton: false,
    voiceSource: "config",
  },
  "cartesia": {
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: true,
    voiceSource: "config",
  },
  "playht": {
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: true,
    voiceSource: "config",
  },
  "coqui": {
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: true,
    voiceSource: "config",
  },
  "tortoise": {
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: true,
    voiceSource: "config",
  },
  "inworld": {
    hasModelSelector: true,
    hasBrowseButton: true,
    hasVoiceIdInput: true,
    voiceSource: "api-language",
    modelKey: "inworld-tts-models",
    apiEndpoint: "/api/media-providers/tts/inworld/voices",
  },
  "qwen": {
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: true,
    voiceSource: "config",
  },
  "minimax": {
    hasModelSelector: true,
    hasBrowseButton: true,
    hasVoiceIdInput: true,
    voiceSource: "api-language",
    apiEndpoint: "/api/media-providers/tts/minimax/voices",
    defaultVoiceId: "English_expressive_narrator",
  },
  "minimax-cn": {
    hasModelSelector: true,
    hasBrowseButton: true,
    hasVoiceIdInput: true,
    voiceSource: "api-language",
    apiEndpoint: "/api/media-providers/tts/minimax/voices?provider=minimax-cn",
    defaultVoiceId: "English_expressive_narrator",
  },
  "gemini": {
    hasLanguageDropdown: false,
    hasLanguageHint: true, // sends body.language to guide TTS pronunciation
    hasModelSelector: true,
    hasBrowseButton: false,
    voiceSource: "hardcoded",
    modelKey: "gemini-tts-models",
    voiceKey: "gemini-tts-voices",
    voicesPerModel: true,
  },
  "xiaomi-mimo": {
    hasLanguageDropdown: false,
    hasModelSelector: true,
    hasBrowseButton: false,
    hasVoiceIdInput: false,
    hasStyleInput: true, // style/voice instructions (role: user)
    hasLanguageHint: true, // language dropdown (Auto-detect default); voices are language-independent
    languageOptions: ["Chinese", "English"],
    voiceSource: "hardcoded",
    modelKey: "xiaomi-mimo-tts-models",
    voicesPerModel: true,
  },
};
