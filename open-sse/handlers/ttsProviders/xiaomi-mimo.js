// Xiaomi MiMo TTS — via OpenAI-compatible chat completions (non-streaming).
// Docs: https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5
// Message contract: target text in `role: assistant` content, style/voice
// instructions in `role: user` content. Voice is selected via the top-level
// `audio.voice` field (NOT embedded in the model name).
import { parseModelVoice } from "./_base.js";

const DEFAULT_MODEL = "mimo-v2.5-tts";
const DEFAULT_VOICE = "mimo_default";

export default {
  synthesize(text, model, credentials, responseFormat, { style, language } = {}) {
    if (!credentials?.apiKey) throw new Error("xiaomi-mimo API key required");
    return synthesizeMiMo(text, model, credentials.apiKey, style, language);
  },
};

export async function synthesizeMiMo(text, model, apiKey, style, language) {
  const { modelId, voiceId } = parseModelVoice(model, DEFAULT_MODEL, DEFAULT_VOICE, [DEFAULT_MODEL]);

  // Language and style are soft instructions → prepend as a role:user message.
  // MiMo auto-detects the spoken language of the text; the hint only nudges it
  // (e.g. "Speak in English.") and is independent of the chosen voice.
  const instructions = [];
  if (language) instructions.push(`Speak in ${language}.`);
  if (style) instructions.push(style);

  const messages = [{ role: "assistant", content: text }];
  if (instructions.length) messages.unshift({ role: "user", content: instructions.join(" ") });

  const res = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: false,
      messages,
      audio: {
        format: "wav",
        voice: voiceId || DEFAULT_VOICE,
      },
    }),
  });

  const rawText = await res.text();
  let data = {};
  if (rawText) {
    try { data = JSON.parse(rawText); } catch { data = {}; }
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || rawText || `MiMo TTS error (${res.status})`);
  }

  const audio = data?.choices?.[0]?.message?.audio?.data;
  if (!audio) throw new Error(data?.error?.message || "MiMo TTS returned no audio");

  return {
    base64: audio,
    format: data?.choices?.[0]?.message?.audio?.format || "wav",
  };
}
