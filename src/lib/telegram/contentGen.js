// Content-generation helpers used by the Telegram bot's /translate, /summarize,
// /post, /script, /idea slash commands.
//
// All of these are thin wrappers around /v1/chat/completions with platform-
// specific system prompts. They reuse the user's current default chat model
// (with Telegram-bot fallback if it errors) so the user pays in the same
// account they already configured.

import { getDefaultModel } from "@/lib/telegram/conversations.js";

const MAX_OUTPUT_TOKENS = 2048;

function gatewayBase() {
  return process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 20128}`;
}
function gatewayKey() {
  const k = process.env.GATEWAY_API_KEY;
  if (!k) throw new Error("GATEWAY_API_KEY not set");
  return k;
}

// Single-shot LLM call. Returns the assistant's text content or throws on error.
async function llm(chatId, system, user, opts = {}) {
  const model = opts.model || (chatId != null ? await getDefaultModel(chatId) : (process.env.TELEGRAM_DEFAULT_MODEL || "kr/claude-sonnet-4.5"));
  const res = await fetch(`${gatewayBase()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return { content: content.trim(), model };
}

// ─── Translate ─────────────────────────────────────────────────────────────

const LANG_NAMES = {
  en: "English", vi: "Vietnamese", zh: "Chinese (Simplified)", "zh-tw": "Chinese (Traditional)",
  ja: "Japanese", ko: "Korean", th: "Thai", id: "Indonesian", ms: "Malay",
  fr: "French", de: "German", es: "Spanish", pt: "Portuguese", it: "Italian",
  ru: "Russian", ar: "Arabic", hi: "Hindi", tr: "Turkish", nl: "Dutch",
};

export function languageName(code) {
  if (!code) return null;
  const c = code.toLowerCase();
  return LANG_NAMES[c] || code;
}

export async function translate({ chatId, text, targetLang, sourceLang }) {
  if (!text || !targetLang) throw new Error("translate needs text and targetLang");
  const target = languageName(targetLang) || targetLang;
  const source = sourceLang ? languageName(sourceLang) : "the source language (auto-detect)";
  const system = [
    "You are a professional translator. Output ONLY the translation, no explanations, no preamble, no quotes around it.",
    "Preserve formatting (line breaks, lists, code blocks). Keep proper nouns and code identifiers untranslated.",
    "Match the register and tone of the original (formal/casual/technical).",
  ].join(" ");
  const user = `Translate the following from ${source} to ${target}:\n\n${text}`;
  return llm(chatId, system, user, { temperature: 0.3 });
}

// ─── Summarize ─────────────────────────────────────────────────────────────

export async function summarize({ chatId, text, style = "default", lang }) {
  if (!text) throw new Error("summarize needs text");
  const langHint = lang ? ` Reply in ${languageName(lang) || lang}.` : "";
  const styleHint = {
    default: "Produce a tight summary in 3-6 bullet points covering the key takeaways. End with a one-line TL;DR.",
    short: "Produce a single-sentence TL;DR. No preamble.",
    long: "Produce a structured summary: 2-paragraph overview, then 5-8 bullets of key points, then 'Open questions' section.",
    eli5: "Explain like the reader is 12. Use simple words and short sentences.",
  }[style] || "Produce a tight summary in 3-6 bullet points.";
  const system = `You are an expert summarizer. ${styleHint}${langHint} Skip preamble like 'Here is a summary'.`;
  return llm(chatId, system, text, { temperature: 0.4, maxTokens: 1500 });
}

// ─── Social-media posts ───────────────────────────────────────────────────

const PLATFORM_SPECS = {
  twitter: {
    name: "Twitter/X",
    spec: [
      "- Hard limit 280 characters TOTAL (including spaces and any links).",
      "- Hook in the first 5 words.",
      "- 0-2 emojis MAX, only if they add meaning.",
      "- 0-2 hashtags MAX, only the ones genuinely searched.",
      "- No 'thread below' style endings unless asked.",
      "- Output only the post text, no quotes or labels.",
    ].join("\n"),
    maxOut: 320,
  },
  x: { ref: "twitter" },
  linkedin: {
    name: "LinkedIn",
    spec: [
      "- 150-300 words, professional but human.",
      "- Strong hook in line 1 (a contrarian take, surprising number, or question).",
      "- Short paragraphs, 1-2 sentences each, blank line between.",
      "- One concrete insight or actionable lesson.",
      "- Soft CTA at the end (a question, not 'follow me').",
      "- 3-5 hashtags at the very end on their own line.",
      "- Skip 'I'm excited to share' and 'thrilled to announce'. Just say what happened.",
    ].join("\n"),
    maxOut: 1200,
  },
  fb: {
    name: "Facebook",
    spec: [
      "- 80-200 words, warm and conversational, like talking to a friend.",
      "- Open with a story, observation, or relatable feeling.",
      "- 1-3 emojis welcome.",
      "- End with a question that invites comments.",
      "- 0-2 hashtags max.",
    ].join("\n"),
    maxOut: 800,
  },
  facebook: { ref: "fb" },
  ig: {
    name: "Instagram",
    spec: [
      "- Caption for an Instagram post.",
      "- Strong opening line that works as a hook even if the rest is collapsed.",
      "- 5-15 lines total.",
      "- 5-15 relevant hashtags at the end on their own line, mix of broad and niche.",
      "- Use line breaks generously (Instagram readers scan, not read).",
    ].join("\n"),
    maxOut: 1200,
  },
  instagram: { ref: "ig" },
  tiktok: {
    name: "TikTok",
    spec: [
      "- TikTok caption (the text below the video).",
      "- 100-150 characters MAX.",
      "- Hook the viewer to watch the full video without spoiling the payoff.",
      "- 3-5 trending-style hashtags at the end (e.g. #fyp #foryou + niche tags).",
    ].join("\n"),
    maxOut: 350,
  },
  thread: {
    name: "Twitter/X thread",
    spec: [
      "- Generate 5-7 tweets that work as a thread.",
      "- Tweet 1: hook + 'thread below 🧵' or similar.",
      "- Tweets 2 to N-1: one idea per tweet, each under 280 chars.",
      "- Final tweet: takeaway + soft CTA (question or follow nudge).",
      "- Number each tweet '1/N', '2/N' at the start of its line.",
      "- Output the tweets separated by a line containing exactly: ---",
      "- No commentary outside the tweets.",
    ].join("\n"),
    maxOut: 2500,
  },
};

function resolvePlatform(p) {
  const key = String(p || "").toLowerCase();
  const found = PLATFORM_SPECS[key];
  if (!found) return null;
  return found.ref ? PLATFORM_SPECS[found.ref] : found;
}

export function platformList() {
  return Object.entries(PLATFORM_SPECS)
    .filter(([, v]) => !v.ref)
    .map(([k]) => k);
}

export async function generatePost({ chatId, platform, topic, tone, lang }) {
  const spec = resolvePlatform(platform);
  if (!spec) {
    throw new Error(`unknown platform '${platform}'. Try: ${platformList().join(", ")}`);
  }
  if (!topic) throw new Error("topic is required");

  const langHint = lang ? ` Write in ${languageName(lang) || lang}.` : "";
  const toneHint = tone ? ` Tone: ${tone}.` : "";
  const system = [
    `You write high-performing ${spec.name} posts. Focus on hooks, specificity, and value over fluff.`,
    "Avoid 'AI-tells': em-dashes used as connectives, 'In conclusion', 'Let's dive in', 'In today's fast-paced world'.",
    "No hashtag stuffing. No engagement-bait questions. No fake urgency.",
    spec.spec,
    `${toneHint}${langHint}`,
  ].join("\n\n");
  return llm(chatId, system, `Topic: ${topic}`, { temperature: 0.85, maxTokens: spec.maxOut });
}

// ─── Video scripts ─────────────────────────────────────────────────────────

const SCRIPT_SPECS = {
  hook: {
    spec: "A strong 5-second video hook. ONE sentence (max 15 words) that makes the viewer NEED to keep watching. Output only the hook line, nothing else.",
    maxOut: 100,
  },
  "30s": {
    spec: [
      "A 30-second short-form video script (TikTok/Reels/Shorts).",
      "Format:",
      "  HOOK (0-3s): one line",
      "  POINT 1 (3-12s): one line",
      "  POINT 2 (12-22s): one line",
      "  PAYOFF + CTA (22-30s): one line",
      "Use plain language. No timestamps inside lines, just the section header.",
    ].join("\n"),
    maxOut: 600,
  },
  "60s": {
    spec: [
      "A 60-second short-form video script.",
      "Format:",
      "  HOOK (0-3s)",
      "  CONTEXT (3-15s) — why this matters",
      "  MAIN CONTENT (15-50s) — three beats, one short paragraph each",
      "  CTA (50-60s)",
    ].join("\n"),
    maxOut: 1200,
  },
  "3min": {
    spec: [
      "A 3-minute YouTube/long-form video script.",
      "Format:",
      "  HOOK (10s) — one paragraph",
      "  INTRO (20s) — what we'll cover, why",
      "  BODY — three sections, each labeled SECTION 1/2/3 with a clear sub-hook + content",
      "  RECAP (20s)",
      "  CTA (10s)",
      "Tone: spoken, direct. Avoid lists in the body — use complete sentences a presenter can read out loud.",
    ].join("\n"),
    maxOut: 3000,
  },
};

export async function generateScript({ chatId, type, topic, lang }) {
  const spec = SCRIPT_SPECS[String(type || "").toLowerCase()];
  if (!spec) throw new Error(`unknown script type '${type}'. Try: ${Object.keys(SCRIPT_SPECS).join(", ")}`);
  if (!topic) throw new Error("topic is required");

  const langHint = lang ? ` Write in ${languageName(lang) || lang}.` : "";
  const system = [
    "You write engaging video scripts. Each line is something a presenter actually says.",
    "No camera directions. No '[insert here]' placeholders. No production notes.",
    "Hooks should be specific (a number, a contrarian claim, a vivid image), not vague ('Did you know...').",
    spec.spec,
    langHint,
  ].join("\n\n");
  return llm(chatId, system, `Topic: ${topic}`, { temperature: 0.8, maxTokens: spec.maxOut });
}

// ─── Content ideas ─────────────────────────────────────────────────────────

export async function generateIdeas({ chatId, niche, count = 5, lang }) {
  if (!niche) throw new Error("niche is required");
  const langHint = lang ? ` Write in ${languageName(lang) || lang}.` : "";
  const system = [
    "You generate content ideas that are specific, actionable, and not generic.",
    "Avoid vague titles like '5 tips for X'. Each idea should imply a concrete angle, hook, or framework.",
    `Output exactly ${count} ideas, numbered 1-${count}, one per line. Each idea: a punchy title (max ~12 words) + a one-line description on the next line.`,
    "Skip preamble.",
    langHint,
  ].join("\n");
  return llm(chatId, system, `Niche: ${niche}`, { temperature: 0.95, maxTokens: 1200 });
}

// ─── Light arg parsing ────────────────────────────────────────────────────

// Strip optional "--key value" trailing flags from a free-form argument string.
// Returns { rest, flags } where flags is an object of parsed key→value pairs.
export function parseFlags(input, allowed = []) {
  const flags = {};
  const allowedSet = new Set(allowed);
  let rest = String(input || "").trim();
  // Iterate from the right peeling off "--key value" pairs in any order.
  // Safer than a global split because values may contain spaces.
  // We look for the LAST "--<key> ..." occurrence and consume the rest of the string after it.
  while (true) {
    const m = rest.match(/(.*?)\s+--(\w+)\s+(.+)$/s);
    if (!m) break;
    const [, before, key, value] = m;
    if (!allowedSet.has(key)) break;
    flags[key] = value.trim();
    rest = before.trim();
  }
  return { rest, flags };
}
