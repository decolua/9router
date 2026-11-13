// OpenRouter TTS — dedicated /audio/speech first (OpenAI shape), legacy
// chat-completions audio fallback for accounts/endpoints that still need it.
import { PROVIDER_MEDIA } from "../../providers/index.js";

const TTS_CFG = PROVIDER_MEDIA["openrouter"]?.ttsConfig || {};
const BASE = (TTS_CFG.baseUrl || "https://openrouter.ai/api/v1/chat/completions").replace(/\/chat\/completions$/, "");
const VOICES = new Set(["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"]);

// "vendor/model" is a model; "vendor/model/voice" is a model plus a known voice.
function splitModelVoice(input, fallbackModel) {
  if (!input) return { ttsModel: fallbackModel, voice: "alloy" };
  const parts = input.split("/");
  if (parts.length >= 3 && VOICES.has(parts.at(-1).toLowerCase())) {
    return { ttsModel: parts.slice(0, -1).join("/"), voice: parts.at(-1).toLowerCase() };
  }
  return { ttsModel: input, voice: undefined };
}

export default {
  async synthesize(text, model, credentials) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    const { ttsModel, voice } = splitModelVoice(model, TTS_CFG.defaultModel);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
      ...(TTS_CFG.headers || {}),
    };

    // 1) Dedicated speech endpoint. OpenRouter rejects pure TTS models on
    //    /chat/completions with "is a text-to-speech model and cannot be used
    //    with the chat/completions endpoint".
    const speech = await fetch(`${BASE}/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: ttsModel, input: text, ...(voice ? { voice } : {}) }),
    });

    if (speech.ok) {
      const buf = Buffer.from(await speech.arrayBuffer());
      const ct = speech.headers.get("content-type") || "audio/mpeg";
      const format = ct.includes("wav") ? "wav" : ct.includes("ogg") ? "ogg" : "mp3";
      return { base64: buf.toString("base64"), format };
    }

    if (speech.status !== 404 && speech.status !== 405) {
      const err = await speech.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter TTS failed: ${speech.status}`);
    }

    // 2) Legacy path: chat completions with the audio modality.
    const res = await fetch(TTS_CFG.baseUrl || `${BASE}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: ttsModel,
        modalities: ["text", "audio"],
        audio: { voice: voice || "alloy", format: "wav" },
        stream: true,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
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
          const audioData = json.choices?.[0]?.delta?.audio?.data;
          if (audioData) chunks.push(audioData);
        } catch {}
      }
    }

    if (chunks.length === 0) throw new Error("OpenRouter TTS returned no audio data");
    return { base64: chunks.join(""), format: "wav" };
  },
};
