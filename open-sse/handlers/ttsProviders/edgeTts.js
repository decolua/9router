// Microsoft Edge / Bing TTS (no auth) — via Bing translator endpoint
import { Buffer } from "node:buffer";
import { UA } from "./_base.js";

const REFRESH_MS = 5 * 60 * 1000; // token TTL ~1h, refresh early
const VOICES_TTL = 24 * 60 * 60 * 1000;

const cache = { token: null, tokenTime: 0 };
let _voicesCache = null;
let _voicesCacheTime = 0;

async function getToken() {
  const now = Date.now();
  if (cache.token && now - cache.tokenTime < REFRESH_MS) return cache.token;
  const res = await fetch("https://www.bing.com/translator", {
    headers: { "User-Agent": UA, "Accept-Language": "vi,en-US;q=0.9,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`Bing translator fetch failed: ${res.status}`);
  const rawCookies = res.headers.getSetCookie?.() || [];
  const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
  const html = await res.text();
  const match = html.match(/params_AbusePreventionHelper\s*=\s*\[([^,]+),([^,]+),/);
  if (!match) throw new Error("Failed to parse Bing token");
  cache.token = { key: match[1], token: match[2].replace(/"/g, ""), cookie };
  cache.tokenTime = now;
  return cache.token;
}

async function ttsRequest(text, voiceId, token) {
  const parts = voiceId.split("-");
  const xmlLang = parts.slice(0, 2).join("-");
  const gender = voiceId.toLowerCase().includes("male") ? "Male" : "Female";
  const ssml = `<speak version='1.0' xml:lang='${xmlLang}'><voice xml:lang='${xmlLang}' xml:gender='${gender}' name='${voiceId}'><prosody rate='0.00%'>${text}</prosody></voice></speak>`;
  const body = new URLSearchParams();
  body.append("ssml", ssml);
  body.append("token", token.token);
  body.append("key", token.key);
  return fetch("https://www.bing.com/tfettts?isVertical=1&&IG=1&IID=translator.5023&SFX=1", {
    method: "POST",
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "*/*",
      "Origin": "https://www.bing.com",
      "Referer": "https://www.bing.com/translator",
      "User-Agent": UA,
      ...(token.cookie ? { "Cookie": token.cookie } : {}),
    },
  });
}

export async function fetchEdgeTtsVoices() {
  const now = Date.now();
  if (_voicesCache && now - _voicesCacheTime < VOICES_TTL) return _voicesCache;
  const res = await fetch(
    "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4",
    { headers: { "User-Agent": UA } }
  );
  if (!res.ok) throw new Error(`Edge TTS voices fetch failed: ${res.status}`);
  const voices = await res.json();
  _voicesCache = voices;
  _voicesCacheTime = now;
  return voices;
}

export default {
  noAuth: true,
  async synthesize(text, model) {
    const voiceId = model || "vi-VN-HoaiMyNeural";
    let token = await getToken();
    let res = await ttsRequest(text, voiceId, token);

    // 429/403: invalidate cache and retry once
    if (res.status === 429 || res.status === 403) {
      cache.token = null;
      cache.tokenTime = 0;
      token = await getToken();
      res = await ttsRequest(text, voiceId, token);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Bing TTS failed: ${res.status}${body ? " - " + body : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error("Bing TTS returned empty audio");
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
