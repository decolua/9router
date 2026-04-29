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
};
