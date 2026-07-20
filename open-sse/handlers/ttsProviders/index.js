// TTS provider registry
import googleTts from "./googleTts.js";
import edgeTts, { fetchEdgeTtsVoices } from "./edgeTts.js";
import localDevice, { fetchLocalDeviceVoices } from "./localDevice.js";
import elevenlabs, { fetchElevenLabsVoices } from "./elevenlabs.js";
import openai from "./openai.js";
import openrouter from "./openrouter.js";
import gemini, { fetchGeminiVoices } from "./gemini.js";
import { FORMAT_HANDLERS } from "./genericFormats.js";
import { parseModelVoice } from "./_base.js";

// Special providers with custom synthesize() logic
const SPECIAL_ADAPTERS = {
  "google-tts": googleTts,
  "edge-tts": edgeTts,
  "local-device": localDevice,
  elevenlabs,
  openai,
  openrouter,
  gemini,
};

export function getTtsAdapter(provider) {
  return SPECIAL_ADAPTERS[provider] || null;
}

// Generic config-driven dispatcher (uses ttsConfig.format)
export async function synthesizeViaConfig(provider, text, model, credentials) {
  const { AI_PROVIDERS } = await import("@/shared/constants/providers");
  const cfg = AI_PROVIDERS[provider]?.ttsConfig;
  if (!cfg) return null;
  const handler = FORMAT_HANDLERS[cfg.format];
  if (!handler) return null;
  const apiKey = credentials?.apiKey;
  if (cfg.authType !== "none" && !apiKey) throw new Error(`${provider} API key required`);
  const { PROVIDER_MODELS } = await import("open-sse/config/providerModels.js");
  const ttsModels = (PROVIDER_MODELS[provider] || []).filter(m => (m.kind || m.type) === "tts");
  const defaultModel = ttsModels[0]?.id || "";
  const { modelId, voiceId } = parseModelVoice(model, defaultModel, "", ttsModels);
  return handler({ baseUrl: cfg.baseUrl, apiKey, text, modelId, voiceId });
}

// Voice fetchers (used by /api/media-providers/tts/voices route)
export const VOICE_FETCHERS = {
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  elevenlabs: fetchElevenLabsVoices,
  gemini: fetchGeminiVoices,
};

// Re-export for backward compat
export { fetchEdgeTtsVoices, fetchLocalDeviceVoices, fetchElevenLabsVoices, fetchGeminiVoices };
