// HTML-mode formatter. Telegram's HTML parser only allows a small whitelist:
// <b><i><u><s><a><code><pre>. Everything else must be escaped.
// Refs: https://core.telegram.org/bots/api#html-style

const TG_MAX = 4000; // Telegram caps at 4096; keep margin for safety

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convert markdown-ish content from LLMs into Telegram-safe HTML.
// We're conservative: convert fenced code blocks and inline code; leave the rest as plain text.
export function toTelegramHtml(text) {
  if (!text) return "";
  const parts = [];
  let i = 0;
  const src = String(text);

  while (i < src.length) {
    const fenceStart = src.indexOf("```", i);
    if (fenceStart === -1) {
      parts.push(processInline(src.slice(i)));
      break;
    }
    if (fenceStart > i) {
      parts.push(processInline(src.slice(i, fenceStart)));
    }
    const fenceEnd = src.indexOf("```", fenceStart + 3);
    if (fenceEnd === -1) {
      const code = src.slice(fenceStart + 3);
      parts.push(`<pre>${escapeHtml(code)}</pre>`);
      break;
    }
    let block = src.slice(fenceStart + 3, fenceEnd);
    block = block.replace(/^\w*\n/, "");
    parts.push(`<pre>${escapeHtml(block)}</pre>`);
    i = fenceEnd + 3;
  }
  return parts.join("");
}

function processInline(s) {
  const escaped = escapeHtml(s);
  return escaped.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
}

export function splitForTelegram(html) {
  if (html.length <= TG_MAX) return [html];
  const out = [];
  let buf = html;
  while (buf.length > TG_MAX) {
    let cut = buf.lastIndexOf("</pre>", TG_MAX);
    if (cut !== -1) cut += "</pre>".length;
    if (cut < TG_MAX / 2) cut = buf.lastIndexOf("\n\n", TG_MAX);
    if (cut < TG_MAX / 2) cut = buf.lastIndexOf("\n", TG_MAX);
    if (cut < 100) cut = TG_MAX;
    out.push(buf.slice(0, cut));
    buf = buf.slice(cut);
  }
  if (buf.length) out.push(buf);
  return out;
}

export function helpText() {
  return [
    "<b>9Router AI Bot</b>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>💬 Just talk</b> — send any message",
    "The bot answers questions, writes code, calls tools automatically.",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>📷 Smart Media Input</b>",
    "• <b>Send a photo</b> → analyzes, describes, reads text/code",
    "  (add caption to ask a specific question)",
    "• <b>Send a file</b> → reads PDF, code, CSV, JSON, TXT, MD...",
    "  (add caption like \"find bugs\" or \"summarize\")",
    "• <b>Send a voice message</b> → transcribes + responds",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>🎨 Generate Media</b>",
    "<code>/img &lt;prompt&gt;</code> — generate an image",
    "<code>/say &lt;text&gt;</code> — text-to-speech (read aloud)",
    "<code>/song &lt;topic&gt;</code> — write song lyrics",
    "  options: <code>--genre pop --mood chill --lang vi</code>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>✍️ Content Creation</b>",
    "<code>/translate [lang] &lt;text&gt;</code> — translate text",
    "<code>/summarize &lt;text or URL&gt;</code> — summarize anything",
    "<code>/post &lt;platform&gt; &lt;topic&gt;</code> — social post",
    "  platforms: twitter, linkedin, fb, ig, tiktok, thread",
    "<code>/script &lt;type&gt; &lt;topic&gt;</code> — video script",
    "  types: hook, 30s, 60s, 3min",
    "<code>/idea &lt;niche&gt;</code> — 5 content ideas",
    "<code>/setlang &lt;code&gt;</code> — set default language",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>🌐 Web Tools</b>",
    "<code>/find &lt;query&gt;</code> — search the web",
    "<code>/get &lt;url&gt;</code> — fetch &amp; extract a page",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>📅 Daily Digest</b>",
    "<code>/digest</code> — view config",
    "<code>/digest on</code> — enable morning briefing",
    "<code>/digest off</code> — disable",
    "<code>/digest now</code> — send one right now",
    "<code>/digest time 8</code> — set hour (0-23)",
    "<code>/digest tz +7</code> — set timezone",
    "<code>/digest topics ai,crypto</code> — news topics",
    "<code>/digest weather Phnom Penh</code> — add weather",
    "<code>/digest lang vi</code> — output language",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>📊 Usage &amp; Status</b>",
    "<code>/usage</code> — chart (today + 7-day)",
    "<code>/usage today</code> — today by provider",
    "<code>/usage week</code> — last 7 days breakdown",
    "<code>/usage detail</code> — text-only summary",
    "<code>/quota</code> — connected providers + activity",
    "<code>/status</code> — gateway health check",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "<b>⚙️ Settings</b>",
    "<code>/model &lt;id&gt;</code> — set chat model",
    "  e.g. <code>/model kr/claude-sonnet-4.5</code>",
    "<code>/models</code> — list all LLM models",
    "<code>/listmodels &lt;kind&gt;</code> — image, tts, stt, etc.",
    "<code>/reset</code> — clear conversation memory",
    "<code>/history</code> — show last 10 turns",
    "<code>/myid</code> — show your Telegram chat ID",
    "<code>/help</code> — this message",
  ].join("\n");
}

// Used by setMyCommands to surface a clickable menu inside Telegram's input
// area. Telegram caps descriptions to 256 chars and command names to 32.
export const BOT_COMMANDS = [
  { command: "translate",  description: "Translate text to another language" },
  { command: "summarize",  description: "Summarize text or a URL" },
  { command: "post",       description: "Generate social-media post (twitter/linkedin/fb/ig/tiktok/thread)" },
  { command: "script",     description: "Write a video script (hook/30s/60s/3min)" },
  { command: "idea",       description: "Generate 5 content ideas" },
  { command: "song",       description: "Write a song (--genre pop --mood happy topic)" },
  { command: "digest",     description: "Daily morning briefing (usage, news, weather, tips)" },
  { command: "setlang",    description: "Set default output language" },
  { command: "img",        description: "Generate an image from a prompt" },
  { command: "say",        description: "Read text aloud (TTS)" },
  { command: "find",       description: "Search the web" },
  { command: "get",        description: "Fetch and extract a URL" },
  { command: "usage",      description: "Show usage chart" },
  { command: "model",      description: "Set the default chat model" },
  { command: "models",     description: "List LLM models" },
  { command: "listmodels", description: "List models by kind (image/tts/stt/...)" },
  { command: "status",     description: "Gateway health + provider count" },
  { command: "quota",      description: "Connected providers + today's usage" },
  { command: "reset",      description: "Clear conversation memory" },
  { command: "history",    description: "Show last 10 turns" },
  { command: "myid",       description: "Show your Telegram chat id" },
  { command: "help",       description: "Show full help" },
];
