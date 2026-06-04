// Generic config-driven TTS handlers — dispatched by ttsConfig.format.
// Each handler accepts { baseUrl, apiKey, text, modelId, voiceId } and returns { base64, format }.
import { responseToBase64, throwUpstreamError } from "./_base.js";
import minimaxTts from "./minimax.js";

// Hyperbolic: POST { text } → { audio: base64 }
async function hyperbolic({ baseUrl, apiKey, text }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) await throwUpstreamError(res);
  const data = await res.json();
  return { base64: data.audio, format: "mp3" };
}

// Deepgram: model via query, Token auth, returns binary
async function deepgram({ baseUrl, apiKey, text, modelId }) {
  const url = new URL(baseUrl);
  url.searchParams.set("model", modelId || "aura-asteria-en");
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Token ${apiKey}` },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "mp3");
}

// Nvidia NIM: POST { input: { text }, voice, model } → binary
async function nvidia({ baseUrl, apiKey, text, modelId, voiceId }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ input: { text }, voice: voiceId || "default", model: modelId }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "wav");
}

// HuggingFace: POST {baseUrl}/{modelId} { inputs: text } → binary
async function huggingface({ baseUrl, apiKey, text, modelId }) {
  if (!modelId || modelId.includes("..")) throw new Error("Invalid HuggingFace model ID");
  const res = await fetch(`${baseUrl}/${modelId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ inputs: text }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "wav");
}

// Inworld: Basic auth, JSON { audioContent }
async function inworld({ baseUrl, apiKey, text, modelId, voiceId }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Basic ${apiKey}` },
    body: JSON.stringify({
      text,
      voiceId: voiceId || "Alex",
      modelId: modelId || "inworld-tts-1.5-mini",
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  if (!res.ok) await throwUpstreamError(res);
  const data = await res.json();
  if (!data.audioContent) throw new Error("Inworld TTS returned no audio");
  return { base64: data.audioContent, format: "mp3" };
}

// Cartesia: X-API-Key header
async function cartesia({ baseUrl, apiKey, text, modelId, voiceId }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
    },
    body: JSON.stringify({
      model_id: modelId || "sonic-2",
      transcript: text,
      ...(voiceId ? { voice: { mode: "id", id: voiceId } } : {}),
      output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
    }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "mp3");
}

// PlayHT: token format "userId:apiKey", voice = s3 URL
async function playht({ baseUrl, apiKey, text, modelId, voiceId }) {
  const [userId, key] = (apiKey || ":").split(":");
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
      "X-USER-ID": userId || "",
      "Authorization": `Bearer ${key || apiKey}`,
    },
    body: JSON.stringify({
      text,
      voice: voiceId || "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
      voice_engine: modelId || "PlayDialog",
      output_format: "mp3",
      speed: 1,
    }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "mp3");
}

// Coqui (local, noAuth): POST { text, speaker_id } → WAV
async function coqui({ baseUrl, text, voiceId }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(voiceId ? { speaker_id: voiceId } : {}) }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "wav");
}

// Tortoise (local, noAuth)
async function tortoise({ baseUrl, text, voiceId }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voiceId || "random" }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "wav");
}

// OpenAI-compatible upstream (qwen3-tts, etc.)
async function openaiCompat({ baseUrl, apiKey, text, modelId, voiceId }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelId,
      input: text,
      voice: voiceId || "alloy",
      response_format: "mp3",
      speed: 1.0,
    }),
  });
  if (!res.ok) await throwUpstreamError(res);
  return responseToBase64(res, "mp3");
}

// format → handler dispatcher
export const FORMAT_HANDLERS = {
  hyperbolic,
  deepgram,
  "nvidia-tts": nvidia,
  "huggingface-tts": huggingface,
  inworld,
  cartesia,
  playht,
  coqui,
  tortoise,
  openai: openaiCompat,
  "minimax-tts": minimaxTts,
};
