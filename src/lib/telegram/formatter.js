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
    "<b>9Router Telegram Bot</b>",
    "",
    "<b>Talk naturally</b> — just send a message. The bot can:",
    "• answer questions, write code",
    "• generate images (\"draw a fox using a router\")",
    "• read text aloud (\"narrate this in Vietnamese\")",
    "• search the web, fetch URLs, show usage",
    "",
    "<b>Content tools</b>",
    "<code>/translate vi &lt;text&gt;</code>      — translate (lang code or default)",
    "<code>/summarize &lt;text/url&gt;</code>     — summarize text or web page",
    "<code>/post &lt;platform&gt; &lt;topic&gt;</code>  — twitter, linkedin, fb, ig, tiktok, thread",
    "<code>/script &lt;type&gt; &lt;topic&gt;</code>  — hook, 30s, 60s, 3min",
    "<code>/idea &lt;niche&gt;</code>            — 5 content ideas",
    "<code>/setlang &lt;code&gt;</code>          — set default output language",
    "",
    "<b>Media</b>",
    "<code>/img &lt;prompt&gt;</code>           — generate image",
    "<code>/say &lt;text&gt;</code>             — text-to-speech",
    "<code>/find &lt;query&gt;</code>           — web search",
    "<code>/get &lt;url&gt;</code>              — fetch &amp; extract",
    "",
    "<b>Status &amp; usage</b>",
    "<code>/usage</code>                — usage chart",
    "<code>/usage week</code>           — last 7 days",
    "<code>/usage detail</code>         — text-only summary",
    "<code>/quota</code>                — connected providers",
    "<code>/status</code>               — gateway health",
    "",
    "<b>Configuration</b>",
    "<code>/model &lt;id&gt;</code>            — set default chat model",
    "<code>/models</code>               — list LLM models",
    "<code>/listmodels image</code>     — list models by kind",
    "<code>/reset</code>                — clear conversation memory",
    "<code>/history</code>              — last 10 turns",
    "<code>/help</code>                 — this message",
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
