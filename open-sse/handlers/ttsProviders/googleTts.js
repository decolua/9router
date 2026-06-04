// Google Translate TTS (no auth) — scrape token + batchexecute RPC
import { UA } from "./_base.js";

const REFRESH_MS = 11 * 60 * 1000;
const cache = { token: null, tokenTime: 0 };
let _idx = 0;

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

export default {
  noAuth: true,
  async synthesize(text, model) {
    const lang = model || "en";
    const token = await getToken();
    const cleanText = text.replace(/[@^*()\\/\-_+=><"'\u201c\u201d\u3010\u3011]/g, " ").replaceAll(", ", ". ");
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
    return { base64, format: "mp3" };
  },
};
