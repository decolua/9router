import { Buffer } from "node:buffer";
import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getTtsAdapter, synthesizeViaConfig } from "./ttsProviders/index.js";

// Re-export voice fetchers + voices APIs for backward compat with existing routes
export {
  VOICE_FETCHERS,
  fetchEdgeTtsVoices,
  fetchLocalDeviceVoices,
  fetchElevenLabsVoices,
} from "./ttsProviders/index.js";

// ── Response Formatter (DRY) ───────────────────────────────────
function createTtsResponse(base64Audio, format, responseFormat) {
  const audioBuffer = Buffer.from(base64Audio, "base64");

  // JSON format: return base64 encoded audio
  if (responseFormat === "json") {
    return {
      success: true,
      response: new Response(JSON.stringify({ audio: base64Audio, format }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  // Binary format (default): return raw audio
  return {
    success: true,
    response: new Response(audioBuffer, {
      headers: {
        "Content-Type": `audio/${format}`,
        "Content-Length": String(audioBuffer.length),
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

// ── Core handler ───────────────────────────────────────────────
/**
 * Synthesize text to audio. Provider logic lives in `./ttsProviders/{id}.js`
 * or is dispatched generically via `ttsConfig.format`.
 *
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleTtsCore({ provider, model, input, credentials, responseFormat = "mp3", language }) {
  if (!input?.trim()) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  try {
    // Special-case adapters (google-tts, edge-tts, local-device, elevenlabs, openai, openrouter, gemini)
    const adapter = getTtsAdapter(provider);
    if (adapter) {
      const result = await adapter.synthesize(input.trim(), model, credentials, responseFormat, { language });
      // Adapter may return a full {success, response} (legacy) or {base64, format}
      if (result.success !== undefined) return result;
      return createTtsResponse(result.base64, result.format, responseFormat);
    }

    // Generic config-driven (hyperbolic, deepgram, nvidia, huggingface, inworld, cartesia, playht, coqui, tortoise, qwen, ...)
    const result = await synthesizeViaConfig(provider, input.trim(), model, credentials);
    if (result) return createTtsResponse(result.base64, result.format, responseFormat);

    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support TTS via this route.`);
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "TTS synthesis failed");
  }
}
