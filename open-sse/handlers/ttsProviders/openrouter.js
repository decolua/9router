// OpenRouter TTS — via chat completions + audio modality (SSE stream)
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { extractPayloadError, OUTCOME_ERROR } from "../../utils/upstreamOutcome.js";

const TTS_CFG = PROVIDER_MEDIA["openrouter"]?.ttsConfig || {};

export default {
  async synthesize(text, model, credentials) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    // model format: "tts-model/voice" e.g. "openai/gpt-4o-mini-tts/alloy"
    let ttsModel = TTS_CFG.defaultModel;
    let voice = "alloy";
    if (model && model.includes("/")) {
      const lastSlash = model.lastIndexOf("/");
      const maybVoice = model.slice(lastSlash + 1);
      const maybeModel = model.slice(0, lastSlash);
      if (maybeModel.includes("/")) {
        ttsModel = maybeModel;
        voice = maybVoice;
      } else {
        voice = model;
      }
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
        audio: { voice, format: "wav" },
        stream: true,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter TTS failed: ${res.status}`);
    }

    // Parse SSE stream and require a valid terminal. Audio chunks received
    // before a later error are not a successful synthesis outcome.
    if (!res.body) throw new Error("OpenRouter TTS returned no stream body");
    const chunks = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let doneSeen = false;
    let finishSeen = false;
    let streamError = null;

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const raw = trimmed.slice(5).trim();
      if (!raw) return;
      if (raw === "[DONE]") {
        doneSeen = true;
        return;
      }

      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        const error = new Error("OpenRouter TTS stream contained malformed JSON");
        error.errorKind = OUTCOME_ERROR.INVALID;
        throw error;
      }

      const payloadError = extractPayloadError(json);
      if (payloadError) {
        streamError = payloadError;
        return;
      }
      const choice = json.choices?.[0];
      if (choice?.finish_reason != null) finishSeen = true;
      const audioData = choice?.delta?.audio?.data;
      if (typeof audioData === "string" && audioData.length > 0) chunks.push(audioData);
    };

    while (!streamError) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
        if (streamError) break;
      }
    }
    buffer += decoder.decode();
    if (!streamError && buffer.trim()) processLine(buffer);

    if (streamError) {
      await reader.cancel(streamError.message).catch(() => {});
      const error = new Error(streamError.message || "OpenRouter TTS stream failed");
      error.errorKind = streamError.errorKind || OUTCOME_ERROR.PAYLOAD_ERROR;
      throw error;
    }
    if (!doneSeen && !finishSeen) {
      const error = new Error("OpenRouter TTS stream ended without a terminal event");
      error.errorKind = OUTCOME_ERROR.INCOMPLETE;
      throw error;
    }
    if (chunks.length === 0) throw new Error("OpenRouter TTS returned no audio data");
    return { base64: chunks.join(""), format: "wav" };
  },
};
