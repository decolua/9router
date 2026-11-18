import { Buffer } from "node:buffer";
import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getTtsAdapter, synthesizeViaConfig } from "./ttsProviders/index.js";
import { pcmLayout, TTS_UPSTREAM_FORMATS } from "../config/ttsCodecs.js";

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
        "Content-Type": format === "mp3" ? "audio/mpeg" : `audio/${format}`,
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
export async function handleTtsCore({ provider, model, input, credentials, responseFormat = "mp3", upstreamFormat, language, style, voice, signal, proxyOptions, onUsage }) {
  if (typeof input !== "string" || !input.trim()) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }
  if (responseFormat === "pcm") return createErrorResult(400, "PCM output is not supported; request WAV or MP3");
  if (upstreamFormat !== undefined && !TTS_UPSTREAM_FORMATS.includes(upstreamFormat)) return createErrorResult(400, "Invalid upstream_response_format");
  const layout = pcmLayout(upstreamFormat);
  const upstreamCodec = layout ? "pcm" : upstreamFormat;

  try {
    if (provider === "codex") {
      if (model !== "speech") return createErrorResult(400, "Use model cx/speech for Codex TTS");
      if (!["wav", "mp3", "json"].includes(responseFormat)) return createErrorResult(400, "Codex TTS supports wav, mp3 or json only");
      if (language || style) return createErrorResult(400, "Codex TTS does not support language or style");
      if (Buffer.byteLength(`Vocalize only the following quoted data: ${JSON.stringify(input)}`) > 500) return createErrorResult(400, "Codex TTS input exceeds the 500-byte context limit");
      if (voice != null && !["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"].includes(voice)) return createErrorResult(400, "Unsupported Codex voice");
      const { synthesizeCodexTts } = await import("./codexTts.js");
      const audio = await synthesizeCodexTts({ input, voice, credentials, signal, proxyOptions, onUsage });
      const format = responseFormat === "wav" ? "wav" : "mp3";
      const output = format === "wav" ? audio : await (await import("./codexTtsAudio.js")).codexWavToMp3(audio, signal);
      return createTtsResponse(output.toString("base64"), format, responseFormat);
    }
    // Special-case adapters (google-tts, edge-tts, local-device, elevenlabs, openai, openrouter, gemini, xiaomi-mimo)
    const adapter = getTtsAdapter(provider);
    if (adapter) {
      if (upstreamFormat && !adapter.supportsUpstreamFormat) return createErrorResult(400, "Upstream codec override is not supported by this adapter");
      const result = await adapter.synthesize(input.trim(), model, credentials, upstreamCodec || responseFormat, { language, style, voice, upstreamFormat: upstreamCodec, onUsage, signal, proxyOptions });
      // Adapter may return a full {success, response} (legacy) or {base64, format}
      if (result.success !== undefined) return result;
      if (result.format === "pcm") {
        const pcm = Buffer.from(result.base64, "base64");
        const { rate, channels } = layout || pcmLayout("pcm");
        if (!pcm.length || pcm.length % (channels * 2) || pcm.length > 6 * 1024 * 1024) throw new Error("Invalid or oversized PCM audio");
        if (!["wav", "mp3", "json"].includes(responseFormat)) return createErrorResult(400, "PCM can only be converted to WAV or MP3");
        const header = Buffer.alloc(44);
        header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
        header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
        header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
        header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
        const wav = Buffer.concat([header, pcm]);
        const format = responseFormat === "mp3" ? "mp3" : "wav";
        const output = format === "wav" ? wav : await (await import("./codexTtsAudio.js")).codexWavToMp3(wav, signal);
        return createTtsResponse(output.toString("base64"), format, responseFormat);
      }
      if (upstreamFormat && responseFormat !== "json" && result.format !== responseFormat) return createErrorResult(400, `Conversion from ${result.format} to ${responseFormat} is not supported`);
      return createTtsResponse(result.base64, result.format, responseFormat);
    }

    // Generic config-driven (hyperbolic, deepgram, nvidia, huggingface, inworld, cartesia, playht, coqui, tortoise, qwen, ...)
    if (upstreamFormat) return createErrorResult(400, "Upstream codec override is not supported by this adapter");
    const result = await synthesizeViaConfig(provider, input.trim(), model, credentials);
    if (result?.format === "pcm") throw new Error("PCM output from this provider requires explicit layout support");
    if (result) return createTtsResponse(result.base64, result.format, responseFormat);

    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support TTS via this route.`);
  } catch (err) {
    return createErrorResult(provider === "codex" ? (err.status || (signal?.aborted ? 504 : 502)) : HTTP_STATUS.BAD_GATEWAY, provider === "codex" ? "Codex speech synthesis failed" : (err.message || "TTS synthesis failed"));
  }
}
