import { Buffer } from "node:buffer";
import { pollinationsHeaders, resolvePollinationsModels } from "../../services/pollinationsModels.js";
import { throwUpstreamError } from "./_base.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

export async function fetchPollinationsVoices(apiKey, options = {}) {
  const { models, suggestedModels } = await resolvePollinationsModels(apiKey ? { apiKey } : {}, options);
  return [...models, ...suggestedModels].filter((model) => model.kind === "tts").flatMap((model) =>
    (model.voices || []).map((voice) => ({
      voice_id: `${model.id}/${voice}`, name: `${model.name} / ${voice}`, model: model.id,
      lang: /^[a-z]{2}-[A-Z]{2}-/.test(voice) ? voice.slice(0, 5) : "und",
    })));
}

export default {
  supportsUpstreamFormat: true,
  async synthesize(text, model = "openai/tts-1", credentials, responseFormat, { voice, style, language, upstreamFormat, signal, proxyOptions } = {}) {
    const headers = { "Content-Type": "application/json", ...pollinationsHeaders(credentials) };
    if (text.length > 10000) throw new Error("Pollinations speech input is limited to 10000 characters");
    // Canonical IDs contain publisher/model, or community/owner/model; a voice is optional.
    const parts = (model || "openai/tts-1").split("/");
    const modelParts = parts[0] === "community" ? 3 : 2;
    const embeddedVoice = parts.length > modelParts ? parts.splice(modelParts).join("/") : undefined;
    const modelId = parts.join("/");
    const format = upstreamFormat || (responseFormat === "json" ? undefined : responseFormat);
    const instructions = [style, language ? `Speak in ${language}.` : null].filter(Boolean).join(" ");
    const response = await proxyAwareFetch("https://gen.pollinations.ai/v1/audio/speech", {
      method: "POST", headers, signal,
      body: JSON.stringify({ model: modelId, input: text, ...(voice || embeddedVoice ? { voice: voice || embeddedVoice } : {}),
        ...(format ? { response_format: format } : {}), ...(instructions ? { instructions } : {}) }),
    }, proxyOptions);
    if (!response.ok) await throwUpstreamError(response);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("audio/")) throw new Error("Pollinations speech returned a non-audio response");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("Pollinations speech returned empty audio");
    const mimeFormats = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/aac": "aac", "audio/opus": "opus", "audio/ogg": "opus", "audio/pcm": "pcm" };
    return { base64: Buffer.from(bytes).toString("base64"), format: mimeFormats[contentType.split(";")[0]] || format || "mp3" };
  },
};
