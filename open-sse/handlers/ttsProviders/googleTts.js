// Google Translate TTS (no auth) — scrape token + batchexecute RPC
import { UA } from "./_base.js";

const REFRESH_MS = 11 * 60 * 1000;
const cache = { token: null, tokenTime: 0 };
let _idx = 0;

// Google Translate TTS RPC accepts up to ~200 chars per request. Longer text
// must be split into chunks and the resulting MP3 segments concatenated.
// MP3 frames are self-delimiting so naive buffer concatenation works (#2287).
const MAX_CHUNK = 190;

async function getToken() {
  const now = Date.now();
  if (cache.token && now - cache.tokenTime < REFRESH_MS) return cache.token;
  const res = await fetch("https://translate.google.com/", { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Google translate fetch failed: ${res.status}`);
  const html = await res.text();
  const fSid = html.match(/"FdrFJe":"(.*?)"/)?.[1];
  const bl = html.match(/"cfb2h":"(.*?)"/)?.[1];
  if (!fSid || !bl) throw new Error("Failed to parse Google token");
  cache.token = { "f.sid": fSid, bl };
  cache.tokenTime = now;
  return cache.token;
}

/**
 * Split text into chunks of at most MAX_CHUNK chars, breaking at sentence
 * boundaries (". ", "? ", "! ") then word boundaries, never mid-word.
 */
function chunkText(text) {
  if (text.length <= MAX_CHUNK) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > MAX_CHUNK) {
    let cut = MAX_CHUNK;

    // Prefer sentence boundary within the window
    for (const sep of [". ", "? ", "! "]) {
      const idx = remaining.lastIndexOf(sep, MAX_CHUNK - 1);
      if (idx > 0) { cut = idx + sep.length; break; }
    }

    // Fall back to word boundary
    if (cut === MAX_CHUNK) {
      const spaceIdx = remaining.lastIndexOf(" ", MAX_CHUNK - 1);
      if (spaceIdx > 0) cut = spaceIdx + 1;
    }

    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Extract base64 MP3 audio from a Google batchexecute response body.
 * The response format is:
 *   )]}'\n\n<size>\n[["wrb.fr","jQ1olc","<json>",...]]\n...
 * We scan all lines for the one that starts with "[" and contains our rpcId.
 */
function extractBase64(data) {
  for (const line of data.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) continue;
    const inner = parsed[0];
    if (inner[1] !== "jQ1olc") continue;
    // inner[2] is the JSON-encoded response payload or null on failure
    if (inner[2] == null) return null;
    let payload;
    try { payload = JSON.parse(inner[2]); } catch { return null; }
    return Array.isArray(payload) ? payload[0] : null;
  }
  return null;
}

async function synthesizeChunk(chunk, lang, token) {
  const rpcId = "jQ1olc";
  const reqId = (++_idx * 100000) + Math.floor(1000 + Math.random() * 9000);
  const query = new URLSearchParams({
    rpcids: rpcId,
    "f.sid": token["f.sid"],
    bl: token.bl,
    hl: lang,
    "soc-app": 1, "soc-platform": 1, "soc-device": 1,
    _reqid: reqId,
    rt: "c",
  });
  const payload = [chunk, lang, null, "undefined", [0]];
  const body = new URLSearchParams();
  body.append("f.req", JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]));
  const res = await fetch(`https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://translate.google.com/" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Google TTS failed: ${res.status}`);
  const data = await res.text();
  const base64 = extractBase64(data);
  if (!base64 || base64.length < 50) throw new Error("Google TTS returned empty audio for chunk");
  return base64;
}

export default {
  noAuth: true,
  async synthesize(text, model) {
    const lang = model || "en";
    const token = await getToken();
    const cleanText = text
      .replace(/[@^*()\\/\-_+=><"'“”【】]/g, " ")
      .replaceAll(", ", ". ");

    const chunks = chunkText(cleanText);

    if (chunks.length === 1) {
      const base64 = await synthesizeChunk(chunks[0], lang, token);
      return { base64, format: "mp3" };
    }

    // Synthesize chunks sequentially and concatenate the raw MP3 bytes.
    // MP3 frames are self-delimiting so concatenating encoded segments works.
    const parts = [];
    for (const chunk of chunks) {
      parts.push(await synthesizeChunk(chunk, lang, token));
    }

    const combined = Buffer.concat(parts.map(b => Buffer.from(b, "base64")));
    return { base64: combined.toString("base64"), format: "mp3" };
  },
};
