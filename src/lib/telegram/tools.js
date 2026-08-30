// Agent tools the Telegram bot exposes to the LLM.
//
// Each tool is a {definition, execute} pair. Definitions follow OpenAI's
// "function tool" schema, which Kiro/Codex/Claude all understand via the
// gateway's /v1/chat/completions tool-call mode.
//
// execute() returns one of:
//   { type: "text",  text: string }                          -> embedded into next model turn
//   { type: "photo", buffer: Buffer, caption?: string }      -> bot sends as photo BEFORE next model turn
//   { type: "audio", buffer: Buffer, mime: string,
//     filename: string, caption?: string }                   -> bot sends as voice/audio
//   { type: "error", message: string }                       -> embedded as `Error: <message>` for the model

import { renderDailyTokens, renderTokensByProvider, renderProvidersOverTime } from "@/lib/telegram/charts.js";
import { getTodaySummary, getWeekDailyTokens, getWeekByProvider, formatNum, formatCost } from "@/lib/telegram/usage.js";

function gatewayBase() {
  return process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 20128}`;
}

function gatewayKey() {
  const k = process.env.GATEWAY_API_KEY;
  if (!k) throw new Error("GATEWAY_API_KEY not set");
  return k;
}

// Pick the first available model of a given kind (image, tts, etc) by querying
// the gateway. The dashboard already filters by what's actually configured for
// the connected providers.
async function listKindModels(kind) {
  try {
    const res = await fetch(`${gatewayBase()}/v1/models/${kind}`, {
      headers: { Authorization: `Bearer ${gatewayKey()}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.data) ? data.data.map((m) => m.id) : [];
  } catch {
    return [];
  }
}

// ─── shared helpers ───────────────────────────────────────────────────────

// Treat these as "try the next provider" rather than terminal errors.
// 400 = model not supported for image gen on this account type
// 401/403 = wrong/expired token, 404 = model not in this provider, 429 = quota,
// 5xx = upstream is down. In all cases, our other connected providers may work.
const FALLBACK_STATUSES = new Set([400, 401, 402, 403, 404, 408, 425, 429, 500, 502, 503, 504]);

function isFallbackError(status, body) {
  if (FALLBACK_STATUSES.has(status)) return true;
  const haystack = String(body || "").toLowerCase();
  if (/quota|rate.?limit|exhausted|exceeded|capacity|overloaded|too many requests|insufficient/.test(haystack)) {
    return true;
  }
  return false;
}

// Build an ordered list of candidate models for a given kind, with the user's
// hint (if any) tried first.
function rankCandidates(available, preferred, ranker) {
  if (preferred && available.includes(preferred)) {
    return [preferred, ...available.filter((m) => m !== preferred)];
  }
  // Stable sort by ranker score (higher = tried first).
  return [...available].sort((a, b) => ranker(b) - ranker(a));
}

const IMAGE_PRIORITY = (id) => {
  const s = String(id).toLowerCase();
  // Penalise text-style models that happen to be exposed for image generation
  // but commonly hit aggressive free-tier quotas (gemini-flash-preview etc).
  // Their score is below default unranked models so the bot will only fall back
  // to them after exhausting the dedicated image pipelines.
  if (/gemini-3.*flash-preview$/.test(s)) return 5;
  if (/gemini-3.*flash-image-preview$/.test(s)) return 75; // dedicated image variant
  if (/imagen/.test(s)) return 100;        // Gemini Imagen (free tier, dedicated)
  if (/cloudflare|@cf\//.test(s)) return 90; // Cloudflare AI
  if (/openrouter/.test(s)) return 80;
  if (/dall-?e-3/.test(s)) return 70;       // OpenAI DALL-E 3 (paid but reliable)
  if (/gpt-image/.test(s)) return 68;
  if (/dall-?e-2/.test(s)) return 60;
  if (/codex/.test(s)) return 15;           // Codex ChatGPT — gpt-5.4 doesn't support image gen
  if (/replicate/.test(s)) return 50;
  if (/gemini-3.*pro-preview/.test(s)) return 30; // pro variants — usually cheaper quota but slower
  return 20;
};

const TTS_PRIORITY = (id) => {
  if (id.startsWith("edge-tts/")) return 100;       // free, no auth
  if (/google.*tts/i.test(id)) return 90;
  if (/openai.*tts|^openai\/tts|tts-1|gpt-4o.*tts/i.test(id)) return 80;
  if (/elevenlabs|^el\//i.test(id)) return 70;
  if (/deepgram/i.test(id)) return 60;
  if (/inworld/i.test(id)) return 50;
  return 10;
};

// ─── generate_image ────────────────────────────────────────────────────────
const generateImage = {
  definition: {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image from a text prompt. Use this when the user asks to draw, illustrate, paint, design, or imagine a picture. The image is sent to the user automatically. Auto-fails over to the next provider if quota is hit.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed visual description of the image to generate." },
          size: { type: "string", description: "Image dimensions like '1024x1024' or '1792x1024'. Optional; defaults to 1024x1024.", default: "1024x1024" },
          model: { type: "string", description: "Optional preferred model id. The bot will still fall back to other providers if this one fails." },
        },
        required: ["prompt"],
      },
    },
  },

  async execute({ prompt, size, model }) {
    if (!prompt || typeof prompt !== "string") {
      return { type: "error", message: "Empty or invalid prompt." };
    }

    const available = await listKindModels("image");
    if (available.length === 0) {
      return { type: "error", message: "No image generation model is available. Connect an image provider in the dashboard (Gemini Imagen, OpenAI, Cloudflare AI, etc.)." };
    }

    const candidates = rankCandidates(available, model, IMAGE_PRIORITY);
    const tried = [];

    for (const candidate of candidates.slice(0, 5)) {
      tried.push(candidate);
      const res = await fetch(`${gatewayBase()}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
        body: JSON.stringify({
          model: candidate,
          prompt,
          size: size || "1024x1024",
          n: 1,
          response_format: "b64_json",
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isFallbackError(res.status, body)) {
          console.warn(`[telegram/img] ${candidate} → ${res.status}, falling back. ${body.slice(0, 120)}`);
          continue; // try next provider
        }
        // Hard error (e.g. 400 bad prompt) — don't keep trying with the same prompt.
        return { type: "error", message: `image gen ${res.status} (${candidate}): ${body.slice(0, 300)}` };
      }

      const data = await res.json();
      const item = data?.data?.[0];

      let buffer = null;
      if (item?.b64_json) {
        buffer = Buffer.from(item.b64_json, "base64");
      } else if (item?.url) {
        const r = await fetch(item.url);
        if (!r.ok) {
          console.warn(`[telegram/img] ${candidate} url fetch ${r.status}, falling back`);
          continue;
        }
        buffer = Buffer.from(await r.arrayBuffer());
      }
      if (!buffer || buffer.length === 0) {
        console.warn(`[telegram/img] ${candidate} returned empty bytes, falling back`);
        continue;
      }

      const fellBack = tried.length > 1;
      const captionLines = [
        `<b>${escapeHtml(candidate)}</b>${fellBack ? `  <i>(fallback after ${tried.length - 1} provider${tried.length - 1 === 1 ? "" : "s"})</i>` : ""}`,
        escapeHtml(prompt.slice(0, 200)),
      ];
      return {
        type: "photo",
        buffer,
        caption: captionLines.join("\n"),
      };
    }

    return {
      type: "error",
      message: `All ${tried.length} image providers failed (quota/auth/down). Tried: ${tried.join(", ")}. Check the dashboard → Media Providers → Image to see which need attention.`,
    };
  },
};

// ─── text_to_speech ────────────────────────────────────────────────────────
const textToSpeech = {
  definition: {
    type: "function",
    function: {
      name: "text_to_speech",
      description:
        "Convert text to spoken audio. Use this when the user asks to read aloud, narrate, voice-over, generate speech, or wants audio output. The audio is sent to the user as a voice message.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to speak. Up to a few thousand characters." },
          voice: { type: "string", description: "Voice id, e.g. 'alloy', 'nova', 'edge-tts/en-US-AriaNeural'. Optional." },
          model: { type: "string", description: "TTS model/voice id (e.g. 'openai/tts-1', 'edge-tts/en-US-AriaNeural'). Picked automatically if omitted." },
          language: { type: "string", description: "BCP-47 hint, e.g. 'en', 'vi', 'ja'. Optional." },
        },
        required: ["text"],
      },
    },
  },

  async execute({ text, voice, model, language }) {
    if (!text || typeof text !== "string") {
      return { type: "error", message: "Empty or invalid text." };
    }

    const available = await listKindModels("tts");
    if (available.length === 0) {
      return { type: "error", message: "No TTS model is available. Connect a TTS provider in the dashboard (Edge TTS / OpenAI / Google / ElevenLabs)." };
    }

    const preferred = model || voice;
    const candidates = rankCandidates(available, preferred, TTS_PRIORITY);
    const tried = [];

    for (const candidate of candidates.slice(0, 5)) {
      tried.push(candidate);
      const res = await fetch(`${gatewayBase()}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
        body: JSON.stringify({
          model: candidate,
          input: text,
          response_format: "mp3",
          ...(language ? { language } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isFallbackError(res.status, body)) {
          console.warn(`[telegram/tts] ${candidate} → ${res.status}, falling back. ${body.slice(0, 120)}`);
          continue;
        }
        return { type: "error", message: `tts ${res.status} (${candidate}): ${body.slice(0, 300)}` };
      }

      const ct = res.headers.get("content-type") || "";
      let buffer;
      let mime = "audio/mpeg";
      let filename = "speech.mp3";
      if (ct.includes("json")) {
        const j = await res.json().catch(() => null);
        const b64 = j?.audio || j?.data?.[0]?.b64 || j?.b64_json;
        if (!b64) {
          console.warn(`[telegram/tts] ${candidate} returned no audio bytes, falling back`);
          continue;
        }
        buffer = Buffer.from(b64, "base64");
      } else {
        buffer = Buffer.from(await res.arrayBuffer());
        if (ct.includes("wav")) { mime = "audio/wav"; filename = "speech.wav"; }
        if (ct.includes("ogg")) { mime = "audio/ogg"; filename = "speech.ogg"; }
      }
      if (!buffer || buffer.length === 0) {
        console.warn(`[telegram/tts] ${candidate} empty audio, falling back`);
        continue;
      }

      const fellBack = tried.length > 1;
      return {
        type: "audio",
        buffer,
        mime,
        filename,
        caption: `<b>${escapeHtml(candidate)}</b>${fellBack ? `  <i>(fallback after ${tried.length - 1})</i>` : ""}`,
      };
    }

    return {
      type: "error",
      message: `All ${tried.length} TTS providers failed. Tried: ${tried.join(", ")}.`,
    };
  },
};

// ─── helpers for web search/fetch (provider IS the model) ────────────────

// /v1/models/web returns ids like "linkup/search" or "searxng/fetch".
// We need just the provider prefix to send as `provider` in the request body.
async function listWebProviders(kind /* "search" | "fetch" */) {
  try {
    const res = await fetch(`${gatewayBase()}/v1/models/web`, {
      headers: { Authorization: `Bearer ${gatewayKey()}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const all = Array.isArray(data?.data) ? data.data : [];
    return all
      .filter((m) => m?.id && m.id.endsWith(`/${kind}`))
      .map((m) => m.id.split("/")[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

const SEARCH_PRIORITY = (id) => {
  const s = String(id).toLowerCase();
  // Prefer free / generous tiers first.
  if (/searxng/.test(s)) return 100;        // self-hosted, no quota
  if (/linkup/.test(s)) return 95;          // 1k/mo free
  if (/google.?pse|gpse/.test(s)) return 90; // 100/day free
  if (/^exa$|exa\.ai|exa\//.test(s)) return 85; // good results, free tier
  if (/searchapi/.test(s)) return 80;
  if (/youcom|you\./.test(s)) return 75;
  if (/perplexity/.test(s)) return 70;
  if (/openai/.test(s)) return 60;
  if (/xai|grok/.test(s)) return 55;
  if (/gemini/.test(s)) return 50;
  return 30;
};

const FETCH_PRIORITY = (id) => {
  const s = String(id).toLowerCase();
  if (/searxng/.test(s)) return 100;
  if (/linkup/.test(s)) return 95;
  if (/jina/.test(s)) return 90;
  if (/firecrawl/.test(s)) return 85;
  if (/^exa$|exa\.ai|exa\//.test(s)) return 80;
  return 50;
};

// ─── web_search ────────────────────────────────────────────────────────────
const webSearch = {
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Use this for questions about recent events, prices, news, real-world facts that may have changed, or anything requiring fresh data. Returns a list of result snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query." },
          max_results: { type: "integer", description: "Max number of results, 1-10. Default 5.", default: 5 },
        },
        required: ["query"],
      },
    },
  },

  async execute({ query, max_results }) {
    if (!query || typeof query !== "string") {
      return { type: "error", message: "Empty or invalid query." };
    }

    const available = await listWebProviders("search");
    if (available.length === 0) {
      return {
        type: "error",
        message: "No web-search provider connected. Add one in dashboard → Media Providers → Web (Linkup, SearXNG, Google PSE, You.com, etc).",
      };
    }
    const candidates = rankCandidates(available, null, SEARCH_PRIORITY);
    const tried = [];

    for (const provider of candidates.slice(0, 4)) {
      tried.push(provider);
      const res = await fetch(`${gatewayBase()}/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
        body: JSON.stringify({
          provider,                  // ← REQUIRED — provider IS the model here
          query,
          max_results: clamp(max_results || 5, 1, 10),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isFallbackError(res.status, body)) {
          console.warn(`[telegram/search] ${provider} → ${res.status}, falling back. ${body.slice(0, 120)}`);
          continue;
        }
        return { type: "error", message: `search ${res.status} (${provider}): ${body.slice(0, 300)}` };
      }
      const data = await res.json();

      // Normalize the results array — Exa, Linkup, SearXNG, Google PSE, etc.
      // all return slightly different shapes. Pick the first array we find.
      let resultsRaw = data;
      for (const key of ["results", "data", "items", "organic", "search_results", "web"]) {
        if (resultsRaw && typeof resultsRaw === "object" && Array.isArray(resultsRaw[key])) {
          resultsRaw = resultsRaw[key];
          break;
        }
        if (resultsRaw && typeof resultsRaw === "object" && resultsRaw[key] && typeof resultsRaw[key] === "object") {
          // One level deeper (e.g. data.results = [...])
          resultsRaw = resultsRaw[key];
        }
      }
      const results = Array.isArray(resultsRaw) ? resultsRaw : [];

      if (!results.length) {
        // Empty results from one provider? Try the next one — often a quota-exhausted provider returns 200 with [].
        continue;
      }
      const summary = results.slice(0, max_results || 5).map((r, i) => {
        const title = String(r?.title || r?.name || "Untitled");
        const url = String(r?.url || r?.link || "");
        const snippetRaw = r?.snippet ?? r?.content ?? r?.description ?? r?.text ?? "";
        const snippet = String(typeof snippetRaw === "string" ? snippetRaw : JSON.stringify(snippetRaw)).slice(0, 300);
        return `${i + 1}. ${title}\n   ${url}\n   ${snippet}`;
      }).join("\n\n");
      const fellBack = tried.length > 1;
      const head = fellBack ? `<i>(via ${provider}, fallback after ${tried.length - 1})</i>\n\n` : "";
      return { type: "text", text: head + summary };
    }

    return {
      type: "error",
      message: `All ${tried.length} search providers failed or empty. Tried: ${tried.join(", ")}.`,
    };
  },
};

// ─── web_fetch ─────────────────────────────────────────────────────────────
const webFetch = {
  definition: {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch and extract the readable text from a URL. Use when the user gives a link or asks to read/summarize a webpage. Returns plain text content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL to fetch (https only)." },
          format: { type: "string", description: "'text' (default), 'markdown', or 'html'.", default: "text" },
          max_chars: { type: "integer", description: "Truncate to this many characters. Default 8000.", default: 8000 },
        },
        required: ["url"],
      },
    },
  },

  async execute({ url, format, max_chars }) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { type: "error", message: "url must start with http(s)://" };
    }

    const available = await listWebProviders("fetch");
    if (available.length === 0) {
      return {
        type: "error",
        message: "No web-fetch provider connected. Add one in dashboard → Media Providers → Web (SearXNG, Linkup, Jina Reader, Firecrawl, etc).",
      };
    }
    const candidates = rankCandidates(available, null, FETCH_PRIORITY);
    const tried = [];

    for (const provider of candidates.slice(0, 4)) {
      tried.push(provider);
      const res = await fetch(`${gatewayBase()}/v1/web/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
        body: JSON.stringify({
          provider,                   // ← REQUIRED — provider IS the model here
          url,
          format: format || "text",
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isFallbackError(res.status, body)) {
          console.warn(`[telegram/fetch] ${provider} → ${res.status}, falling back. ${body.slice(0, 120)}`);
          continue;
        }
        return { type: "error", message: `fetch ${res.status} (${provider}): ${body.slice(0, 300)}` };
      }
      const data = await res.json();
      // Some providers wrap the content one level deep (e.g. data.results.content,
      // data.data.content, data.contents[0].text, etc). Walk a couple of common
      // shapes before giving up.
      let contentRaw =
        data?.content ??
        data?.text ??
        data?.markdown ??
        data?.results?.content ??
        data?.results?.text ??
        data?.data?.content ??
        data?.data?.text ??
        (Array.isArray(data?.contents) ? data.contents[0]?.text : null) ??
        (Array.isArray(data?.results) ? data.results[0]?.text : null) ??
        "";
      const content = typeof contentRaw === "string" ? contentRaw : String(contentRaw || "");
      if (!content) continue; // empty page — try the next provider
      const limit = clamp(max_chars || 8000, 500, 30000);
      const fellBack = tried.length > 1;
      const head = fellBack ? `(via ${provider}, fallback after ${tried.length - 1})\n\n` : "";
      return { type: "text", text: head + content.slice(0, limit) };
    }

    return {
      type: "error",
      message: `All ${tried.length} fetch providers failed or empty. Tried: ${tried.join(", ")}.`,
    };
  },
};

// ─── usage_chart ───────────────────────────────────────────────────────────
const usageChart = {
  definition: {
    type: "function",
    function: {
      name: "usage_chart",
      description:
        "Render a chart of the user's AI usage and send it as an image. Use when the user asks 'show me my usage', 'how many tokens have I used', 'usage chart', etc.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "week", "all"],
            description: "today = bar chart of today's tokens by provider; week (default) = stacked bar of last 7 days; all = multi-line per provider over last 7 days.",
            default: "week",
          },
        },
      },
    },
  },

  async execute({ period }) {
    const p = (period || "week").toLowerCase();
    if (p === "today") {
      const s = await getTodaySummary();
      if (s.byProvider.length === 0) return { type: "text", text: "No usage today yet." };
      const png = await renderTokensByProvider(s.byProvider, { title: "Tokens by provider — today" });
      return {
        type: "photo",
        buffer: png,
        caption: `<b>Today</b>\n${formatNum(s.totalRequests)} req · ${formatNum(s.totalTokens)} tokens · ${formatCost(s.totalCost)}`,
      };
    }
    if (p === "all" || p === "providers" || p === "7d") {
      const { providers, labels } = await getWeekByProvider();
      if (providers.length === 0) return { type: "text", text: "No usage in the last 7 days." };
      const png = await renderProvidersOverTime(providers, labels, { title: "Tokens per provider — last 7 days" });
      return { type: "photo", buffer: png, caption: "<b>Last 7 days</b>" };
    }
    // default: week stacked bar
    const week = await getWeekDailyTokens();
    if (week.length === 0 || week.every((d) => d.totalTokens === 0)) {
      return { type: "text", text: "No usage in the last 7 days." };
    }
    const png = await renderDailyTokens(week, { title: "Tokens — last 7 days" });
    return { type: "photo", buffer: png, caption: "<b>Last 7 days</b>" };
  },
};

// ─── helpers ───────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// ─── registry ──────────────────────────────────────────────────────────────
export const TOOLS = {
  generate_image: generateImage,
  text_to_speech: textToSpeech,
  web_search: webSearch,
  web_fetch: webFetch,
  usage_chart: usageChart,
};

export function toolDefinitions() {
  return Object.values(TOOLS).map((t) => t.definition);
}

export async function executeToolCall(name, argsJson) {
  const tool = TOOLS[name];
  if (!tool) return { type: "error", message: `unknown tool: ${name}` };
  let args = {};
  try {
    args = typeof argsJson === "string" ? JSON.parse(argsJson) : (argsJson || {});
  } catch (e) {
    return { type: "error", message: `bad args json: ${e?.message}` };
  }
  try {
    return await tool.execute(args);
  } catch (e) {
    return { type: "error", message: e?.message || String(e) };
  }
}
