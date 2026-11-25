// OpenAI TTS — model format: "tts-model/voice"
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { responseToBase64 } from "./_base.js";

const DEFAULT_TTS_MODEL = PROVIDER_MEDIA["openai"]?.ttsConfig?.defaultModel;

export default {
  async synthesize(text, model, credentials) {
    if (!credentials?.apiKey) throw new Error("No OpenAI API key configured");

    let ttsModel = DEFAULT_TTS_MODEL;
    let voice = "alloy";
    if (model && model.includes("/")) {
      const parts = model.split("/");
      if (parts.length === 2) [ttsModel, voice] = parts;
    } else if (model) {
      voice = model;
    }

    const baseUrl = (credentials.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${credentials.apiKey}` },
      body: JSON.stringify({ model: ttsModel, voice, input: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI TTS failed: ${res.status}`);
    }
    return responseToBase64(res, "mp3");
  },
};
