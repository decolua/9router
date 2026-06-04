// OpenAI TTS — model format: "tts-model/voice"
import { Buffer } from "node:buffer";

export default {
  async synthesize(text, model, credentials) {
    if (!credentials?.apiKey) throw new Error("No OpenAI API key configured");

    let ttsModel = "gpt-4o-mini-tts";
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
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
