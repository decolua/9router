// OpenRouter TTS — via chat completions + audio modality (SSE stream)
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { extractUsage } from "../../utils/usageTracking.js";

const TTS_CFG = PROVIDER_MEDIA["openrouter"]?.ttsConfig || {};

export default {
  supportsUpstreamFormat: true,
  async synthesize(text, model, credentials, responseFormat, options = {}) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    // model format: "tts-model/voice" e.g. "openai/gpt-4o-mini-tts/alloy"
    let ttsModel = TTS_CFG.defaultModel;
    let voice = options.voice || "alloy";
    if (model && options.voice) {
      ttsModel = model;
    } else if (model && model.includes("/")) {
      const lastSlash = model.lastIndexOf("/");
      const maybVoice = model.slice(lastSlash + 1);
      const maybeModel = model.slice(0, lastSlash);
      if (maybeModel.includes("/")) {
        ttsModel = maybeModel;
        voice = maybVoice;
      } else ttsModel = model;
    } else if (model) {
      voice = model;
    }

    const res = await fetch(TTS_CFG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.apiKey}`,
        ...(TTS_CFG.headers || {}),
      },
      body: JSON.stringify({
        model: ttsModel,
        modalities: ["text", "audio"],
        audio: { voice, format: options.upstreamFormat || "wav" },
        stream: true,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // ponytail: retry only the explicit endpoint mismatch; add model transport metadata if OpenRouter documents it.
      if (typeof err?.error?.message === "string" && err.error.message.includes("/api/v1/audio/speech")) {
        const speech = await fetch(TTS_CFG.speechUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}`, ...(TTS_CFG.headers || {}) },
          body: JSON.stringify({ model: ttsModel, input: text, voice, response_format: options.upstreamFormat || "mp3" }),
        });
        if (!speech.ok) {
          const failure = await speech.json().catch(() => ({}));
          throw new Error(failure?.error?.message || `OpenRouter TTS failed: ${speech.status}`);
        }
        return { base64: Buffer.from(await speech.arrayBuffer()).toString("base64"), format: options.upstreamFormat || "mp3" };
      }
      throw new Error(err?.error?.message || `OpenRouter TTS failed: ${res.status}`);
    }

    // Parse SSE stream, accumulate base64 audio chunks
    const chunks = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const json = JSON.parse(line.slice(6));
          options.onUsage?.(extractUsage(json));
          const audioData = json.choices?.[0]?.delta?.audio?.data;
          if (audioData) chunks.push(audioData);
        } catch {}
      }
    }

    if (chunks.length === 0) throw new Error("OpenRouter TTS returned no audio data");
    return { base64: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64"))).toString("base64"), format: options.upstreamFormat || "wav" };
  },
};
