import { Buffer } from "node:buffer";

function hexToBase64(audioHex) {
  const clean = typeof audioHex === "string" ? audioHex.trim() : "";
  if (!clean) throw new Error("MiniMax TTS returned no audio");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    throw new Error("MiniMax TTS returned invalid audio");
  }
  return Buffer.from(clean, "hex").toString("base64");
}

// MiniMax T2A HTTP: returns hex-encoded audio in non-streaming mode.
export default async function minimaxTts({ baseUrl, apiKey, text, modelId, voiceId }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelId || "speech-2.8-hd",
      text,
      stream: false,
      language_boost: "auto",
      output_format: "hex",
      voice_setting: {
        voice_id: voiceId || "English_expressive_narrator",
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    }),
  });

  const rawText = await res.text();
  let data = {};
  if (rawText) {
    try { data = JSON.parse(rawText); } catch { data = {}; }
  }

  const baseResp = data.base_resp || data.baseResp || {};
  const statusCode = Number(baseResp.status_code ?? baseResp.statusCode ?? 0);
  const statusMessage = baseResp.status_msg || baseResp.statusMsg || data.message || "";

  if (!res.ok) {
    throw new Error(statusMessage || rawText || `MiniMax TTS error (${res.status})`);
  }
  if (statusCode !== 0) {
    throw new Error(statusMessage || "MiniMax TTS upstream error");
  }

  return {
    base64: hexToBase64(data.data?.audio),
    format: data.extra_info?.audio_format || data.extraInfo?.audioFormat || "mp3",
  };
}
