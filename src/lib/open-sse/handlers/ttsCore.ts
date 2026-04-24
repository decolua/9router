/**
 * Core TTS handler
 */

import { promisify } from "util";
import { execFile } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, readFile, rm } from "fs/promises";
import { createErrorResult } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { GOOGLE_TTS_LANGUAGES } from "../config/googleTtsLanguages";

const execFileAsync = promisify(execFile);

function createTtsResponse(base64Audio: string, sourceFormat: string, responseFormat: string = "mp3"): any {
  if (responseFormat === "json") {
    return {
      success: true,
      response: new Response(JSON.stringify({
        audio: base64Audio,
        format: sourceFormat,
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  const binary = Buffer.from(base64Audio, "base64");
  return {
    success: true,
    response: new Response(binary, {
      headers: {
        "Content-Type": `audio/${sourceFormat === "wav" ? "wav" : "mpeg"}`,
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

// ── Token cache per engine ─────────────────────────────────────
const cache: Record<string, { token: any, tokenTime: number }> = {
  google: { token: null, tokenTime: 0 },
  bing:   { token: null, tokenTime: 0 },
};

const GOOGLE_REFRESH = 11 * 60 * 1000;
const BING_REFRESH   = 5 * 60 * 1000;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

// ── Google TTS ─────────────────────────────────────────────────
async function getGoogleToken(): Promise<any> {
  const now = Date.now();
  if (cache.google.token && now - cache.google.tokenTime < GOOGLE_REFRESH) {
    return cache.google.token;
  }
  const res = await fetch("https://translate.google.com/", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Google translate fetch failed: ${res.status}`);
  const html = await res.text();
  const fSid = html.match(/"FdrFJe":"(.*?)"/)?.[1];
  const bl   = html.match(/"cfb2h":"(.*?)"/)?.[1];
  if (!fSid || !bl) throw new Error("Failed to parse Google token");
  cache.google.token = { "f.sid": fSid, bl };
  cache.google.tokenTime = now;
  return cache.google.token;
}

let _googleIdx = 0;
async function googleTts(text: string, lang: string): Promise<string> {
  const token = await getGoogleToken();
  const cleanText = text.replace(/[@^*()\\/\-_+=><"'\u201c\u201d\u3010\u3011]/g, " ").replaceAll(", ", ". ");
  const rpcId = "jQ1olc";
  const reqId = (++_googleIdx * 100000) + Math.floor(1000 + Math.random() * 9000);
  const query = new URLSearchParams({
    rpcids: rpcId,
    "f.sid": token["f.sid"],
    bl: token.bl,
    hl: lang,
    "soc-app": "1", "soc-platform": "1", "soc-device": "1",
    _reqid: String(reqId),
    rt: "c",
  });
  const payload = [cleanText, lang, null, "undefined", [0]];
  const body = new URLSearchParams();
  body.append("f.req", JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]));
  const res = await fetch(`https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://translate.google.com/" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Google TTS failed: ${res.status}`);
  const data = await res.text();
  const split = JSON.parse(data.split("\n")[3]);
  const base64 = JSON.parse(split[0][2])[0];
  if (!base64 || base64.length < 100) throw new Error("Google TTS returned empty audio");
  return base64;
}

// ── Bing TTS ───────────────────────────────────────────────────
async function getBingToken(): Promise<any> {
  const now = Date.now();
  if (cache.bing.token && now - cache.bing.tokenTime < BING_REFRESH) {
    return cache.bing.token;
  }
  const res = await fetch("https://www.bing.com/translator", {
    headers: { "User-Agent": UA, "Accept-Language": "vi,en-US;q=0.9,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`Bing translator fetch failed: ${res.status}`);
  const rawCookies = (res.headers as any).getSetCookie?.() || [];
  const cookie = rawCookies.map((c: string) => c.split(";")[0]).join("; ");
  const html = await res.text();
  const match = html.match(/params_AbusePreventionHelper\s*=\s*\[([^,]+),([^,]+),/);
  if (!match) throw new Error("Failed to parse Bing token");
  cache.bing.token = { key: match[1], token: match[2].replace(/"/g, ""), cookie };
  cache.bing.tokenTime = now;
  return cache.bing.token;
}

async function bingTtsRequest(text: string, voiceId: string, token: any): Promise<Response> {
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

async function bingTts(text: string, voiceId: string): Promise<string> {
  let token = await getBingToken();
  let res = await bingTtsRequest(text, voiceId, token);

  if (res.status === 429 || res.status === 403) {
    cache.bing.token = null;
    cache.bing.tokenTime = 0;
    token = await getBingToken();
    res = await bingTtsRequest(text, voiceId, token);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bing TTS failed: ${res.status}${body ? " - " + body : ""}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1024) throw new Error("Bing TTS returned empty audio");
  return Buffer.from(buf).toString("base64");
}

// ── Local Device TTS ──────────────────────────────────────────
let _localVoicesCache: any[] | null = null;

async function fetchLocalDeviceVoicesMac(): Promise<any[]> {
  const { stdout } = await execFileAsync("say", ["-v", "?"]);
  const voices = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^([^\s].*?)\s{2,}([a-z]{2}_[A-Z]{2})/);
    if (!m) continue;
    const name    = m[1].trim();
    const locale  = m[2].trim();
    const lang    = locale.split("_")[0];
    const country = locale.split("_")[1];
    voices.push({ id: name, name, locale, lang, country, gender: "" });
  }
  return voices;
}

async function fetchLocalDeviceVoicesWin(): Promise<any[]> {
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$s.GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo;",
    "[PSCustomObject]@{ Name=$v.Name; Culture=$v.Culture.Name; Gender=$v.Gender } }",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true }
  );
  const raw = JSON.parse(stdout.trim() || "[]");
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v: any) => {
    const culture = v.Culture || "en-US";
    const [lang, country = ""] = culture.split("-");
    const genderMap: Record<any, string> = { 1: "Male", 2: "Female", Male: "Male", Female: "Female" };
    return {
      id:      v.Name,
      name:    v.Name,
      locale:  culture.replace("-", "_"),
      lang,
      country,
      gender:  genderMap[v.Gender] || "",
    };
  });
}

export async function fetchLocalDeviceVoices(): Promise<any[]> {
  if (_localVoicesCache) return _localVoicesCache;
  try {
    const voices = process.platform === "win32"
      ? await fetchLocalDeviceVoicesWin()
      : await fetchLocalDeviceVoicesMac();
    _localVoicesCache = voices;
    return voices;
  } catch {
    return [];
  }
}

async function localDeviceTts(text: string, voiceId: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tts-"));
  const aiffPath = join(dir, "out.aiff");
  const mp3Path  = join(dir, "out.mp3");
  try {
    const args = voiceId ? ["-v", voiceId, "-o", aiffPath, text] : ["-o", aiffPath, text];
    await execFileAsync("say", args);
    await execFileAsync("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-qscale:a", "4", mp3Path]);
    const buf = await readFile(mp3Path);
    return buf.toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── Voices list (Edge TTS public endpoint) ─────────────────────
let _voicesCache: any = null;
let _voicesCacheTime = 0;
const VOICES_TTL = 24 * 60 * 60 * 1000;

export async function fetchEdgeTtsVoices(): Promise<any> {
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

// ── ElevenLabs TTS ─────────────────────────────────────────────
const _elevenlabsVoicesCache = new Map<string, { voices: any[], time: number }>();

export async function fetchElevenLabsVoices(apiKey: string): Promise<any[]> {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  
  const now = Date.now();
  const cached = _elevenlabsVoicesCache.get(apiKey);
  if (cached && now - cached.time < VOICES_TTL) {
    return cached.voices;
  }
  
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
  });
  
  if (!res.ok) throw new Error(`ElevenLabs voices fetch failed: ${res.status}`);
  const data = await res.json();
  const voices = (data.voices || []).map((v: any) => ({
    ...v,
    lang: v.labels?.language || "en",
  }));
  _elevenlabsVoicesCache.set(apiKey, { voices, time: now });
  return voices;
}

async function elevenlabsTts(text: string, voiceId: string, apiKey: string, modelId = "eleven_flash_v2_5"): Promise<string> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail?.message || `ElevenLabs TTS failed: ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1024) throw new Error("ElevenLabs TTS returned empty audio");
  return Buffer.from(buf).toString("base64");
}

export const VOICE_FETCHERS: Record<string, any> = {
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  "elevenlabs": fetchElevenLabsVoices,
};

// ── OpenRouter TTS ─────────────────────────────────────────────
async function handleOpenRouterTts({ model, input, credentials, responseFormat = "mp3" }: any): Promise<any> {
  if (!credentials?.apiKey) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No OpenRouter API key configured");
  }

  let ttsModel = "openai/gpt-4o-mini-tts";
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

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.apiKey}`,
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
    body: JSON.stringify({
      model: ttsModel,
      modalities: ["text", "audio"],
      audio: { voice, format: "wav" },
      stream: true,
      messages: [{ role: "user", content: input }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return createErrorResult(res.status, err?.error?.message || `OpenRouter TTS failed: ${res.status}`);
  }

  const chunks = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const json = JSON.parse(line.slice(6));
        const audioData = json.choices?.[0]?.delta?.audio?.data;
        if (audioData) chunks.push(audioData);
      } catch {}
    }
  }

  if (chunks.length === 0) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "OpenRouter TTS returned no audio data");
  }

  const base64Audio = chunks.join("");
  return createTtsResponse(base64Audio, "wav", responseFormat);
}

// ── OpenAI TTS ──────────────────────────────────────────────────
async function handleOpenAiTts({ model, input, credentials, responseFormat = "mp3" }: any): Promise<any> {
  if (!credentials?.apiKey) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No OpenAI API key configured");
  }

  let ttsModel = "gpt-4o-mini-tts";
  let voice = "alloy";
  if (model && model.includes("/")) {
    const parts = model.split("/");
    if (parts.length === 2) {
      [ttsModel, voice] = parts;
    }
  } else if (model) {
    voice = model;
  }

  const baseUrl = (credentials.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.apiKey}`,
    },
    body: JSON.stringify({ model: ttsModel, voice, input }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return createErrorResult(res.status, err?.error?.message || `OpenAI TTS failed: ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  const base64 = Buffer.from(buf).toString("base64");
  return createTtsResponse(base64, "mp3", responseFormat);
}

// ── TTS Provider Registry ─────────────────────────────────────
const TTS_PROVIDERS: Record<string, { synthesize: (text: string, model: string, credentials?: any, responseFormat?: string) => Promise<any>, requiresCredentials: boolean }> = {
  "google-tts": {
    synthesize: async (text, model) => {
      const base64 = await googleTts(text, model || "en");
      return { base64, format: "mp3" };
    },
    requiresCredentials: false,
  },
  "edge-tts": {
    synthesize: async (text, model) => {
      const base64 = await bingTts(text, model || "vi-VN-HoaiMyNeural");
      return { base64, format: "mp3" };
    },
    requiresCredentials: false,
  },
  "local-device": {
    synthesize: async (text, model) => {
      const base64 = await localDeviceTts(text, model);
      return { base64, format: "mp3" };
    },
    requiresCredentials: false,
  },
  "elevenlabs": {
    synthesize: async (text, model, credentials) => {
      if (!credentials?.apiKey) {
        throw new Error("ElevenLabs API key required");
      }
      let modelId = "eleven_flash_v2_5";
      let voiceId = model;
      if (model && model.includes("/")) {
        [modelId, voiceId] = model.split("/");
      }
      const base64 = await elevenlabsTts(text, voiceId, credentials.apiKey, modelId);
      return { base64, format: "mp3" };
    },
    requiresCredentials: true,
  },
  "openai": {
    synthesize: async (text, model, credentials, responseFormat) => {
      return await handleOpenAiTts({ model, input: text, credentials, responseFormat });
    },
    requiresCredentials: true,
  },
  "openrouter": {
    synthesize: async (text, model, credentials, responseFormat) => {
      return await handleOpenRouterTts({ model, input: text, credentials, responseFormat });
    },
    requiresCredentials: true,
  },
};

export interface TtsCoreOptions {
  provider: string;
  model: string;
  input: string;
  credentials?: any;
  responseFormat?: string;
}

/**
 * Synthesize text to audio.
 */
export async function handleTtsCore({ provider, model, input, credentials, responseFormat = "mp3" }: TtsCoreOptions): Promise<any> {
  if (!input?.trim()) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  const ttsProvider = TTS_PROVIDERS[provider];
  if (!ttsProvider) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support TTS via this route.`);
  }

  try {
    const result = await ttsProvider.synthesize(input.trim(), model, credentials, responseFormat);
    
    if (result.success !== undefined) return result;
    
    return createTtsResponse(result.base64, result.format, responseFormat);
  } catch (err: any) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err.message || "TTS synthesis failed");
  }
}
