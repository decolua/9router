// Telegram webhook receiver. POST-only.
//
// Triggered by Telegram when the bot receives a message. Authenticates via
// X-Telegram-Bot-Api-Secret-Token + owner chat_id allowlist. Dispatches
// commands and forwards plain text to /v1/chat/completions with conversation
// memory. Responds 200 immediately to Telegram and processes async — the
// outgoing chat completion can take 30s+ which exceeds Telegram's 60s
// webhook timeout if we block the response.

import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram/client.js";
import { checkSecret, isAllowed } from "@/lib/telegram/guards.js";
import {
  getHistory,
  appendMessage,
  clearHistory,
  getDefaultModel,
  setDefaultModel,
} from "@/lib/telegram/conversations.js";
import { toTelegramHtml, splitForTelegram, helpText } from "@/lib/telegram/formatter.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { getTodaySummary, getWeekDailyTokens, getWeekByProvider, formatNum, formatCost } from "@/lib/telegram/usage.js";
import { renderDailyTokens, renderTokensByProvider, renderProvidersOverTime } from "@/lib/telegram/charts.js";
import { TOOLS, toolDefinitions, executeToolCall } from "@/lib/telegram/tools.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import {
  translate,
  summarize,
  generatePost,
  generateScript,
  generateIdeas,
  parseFlags,
  languageName,
  platformList,
} from "@/lib/telegram/contentGen.js";
import { getAdapter } from "@/lib/db/driver.js";
import {
  downloadTelegramFile,
  getBestPhotoFileId,
  analyzeImage,
  analyzeDocument,
  transcribeVoice,
  generateSong,
  generateSongAudio,
} from "@/lib/telegram/media.js";
import { getDigestConfig, setDigestConfig } from "@/lib/telegram/digest.js";
import { triggerDigestNow } from "@/lib/telegram/scheduler.js";

const SYSTEM_PROMPT = [
  "You are a direct, capable AI assistant operating inside Telegram. You have tools available; use them whenever they would help the user.",
  "",
  "Behavior:",
  "- Do what the user asks. Don't ask clarifying questions unless the request is genuinely ambiguous in a way that would lead to a wrong result.",
  "- Make reasonable assumptions and act. Skip preamble like 'Sure!' or 'Of course'. No 'Is there anything else?'.",
  "- For coding: just write the code in fenced code blocks.",
  "- For factual/recent questions: call web_search.",
  "- For 'show me / draw / generate / illustrate / a picture of': call generate_image.",
  "- For 'read aloud / narrate / voice / say / speak this': call text_to_speech.",
  "- For 'fetch / read / summarize this URL': call web_fetch.",
  "- For 'show usage / tokens / quota / chart of usage': call usage_chart.",
  "- After a tool returns, briefly confirm what was done. Don't dump the raw tool output back as JSON.",
].join("\n");

const MAX_TOOL_TURNS = 5; // hard cap to prevent runaway loops

export async function POST(request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const msg = update?.message;
  if (!msg) return NextResponse.json({ ok: true }); // ignore non-message updates

  const userId = msg.from?.id;
  const chatId = msg.chat?.id;
  const text = (msg.text || msg.caption || "").trim();

  if (!chatId) return NextResponse.json({ ok: true });

  // /myid is the one command we always answer (helps you set up TELEGRAM_OWNER_CHAT_ID
  // if you didn't get it from @userinfobot for some reason).
  if (text === "/myid" || text.startsWith("/myid ")) {
    await safeSend(chatId, `Your chat id: <code>${userId}</code>`);
    return NextResponse.json({ ok: true });
  }

  if (!isAllowed(userId)) {
    return NextResponse.json({ ok: true });
  }

  // ─── Media messages: photo, document, voice ──────────────────────────
  if (msg.photo) {
    handlePhoto(chatId, msg).catch((e) => {
      console.error("[telegram] photo handler error:", e);
      safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
    });
    return NextResponse.json({ ok: true });
  }

  if (msg.document) {
    handleDocument(chatId, msg).catch((e) => {
      console.error("[telegram] document handler error:", e);
      safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
    });
    return NextResponse.json({ ok: true });
  }

  if (msg.voice || msg.audio) {
    handleVoice(chatId, msg).catch((e) => {
      console.error("[telegram] voice handler error:", e);
      safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
    });
    return NextResponse.json({ ok: true });
  }

  // Text-only messages require text content
  if (!text) return NextResponse.json({ ok: true });

  // Don't make Telegram wait for the LLM. Ack now, finish in the background.
  handle(chatId, text).catch((e) => {
    console.error("[telegram] handler error:", e);
    safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  });

  return NextResponse.json({ ok: true });
}

async function handle(chatId, text) {
  if (text === "/start" || text === "/help") {
    return safeSend(chatId, helpText());
  }

  if (text === "/status") {
    const providersCount = await countActiveProviders();
    const lines = [
      "<b>Status</b>",
      `Gateway: <code>https://airouter-kh.fly.dev</code>`,
      `Health: ✅ ok`,
      `Active providers: <b>${providersCount}</b>`,
      `Default model: <code>${escapeForCode(await getDefaultModel(chatId))}</code>`,
    ];
    return safeSend(chatId, lines.join("\n"));
  }

  if (text === "/models") {
    const list = await buildModelsList(["llm"]);
    const ids = list.map((m) => m.id).slice(0, 80);
    const html =
      `<b>Available models</b> (${list.length} total, showing first ${ids.length})\n\n` +
      ids.map((id) => `<code>${escapeForCode(id)}</code>`).join("\n");
    for (const part of splitForTelegram(html)) {
      await safeSend(chatId, part);
    }
    return;
  }

  if (text === "/listmodels" || text.startsWith("/listmodels ")) {
    const arg = text === "/listmodels" ? "image" : text.slice(12).trim().toLowerCase();
    return listModelsByKind(chatId, arg);
  }

  if (text === "/providers" || text === "/quota") {
    return showProviderStatus(chatId);
  }

  if (text.startsWith("/model ")) {
    const model = text.slice(7).trim();
    if (!model) return safeSend(chatId, "Usage: <code>/model kr/claude-sonnet-4.5</code>");
    await setDefaultModel(chatId, model);
    return safeSend(chatId, `Default model set to <code>${escapeForCode(model)}</code>`);
  }

  if (text === "/reset") {
    await clearHistory(chatId);
    return safeSend(chatId, "Conversation memory cleared.");
  }

  if (text === "/history") {
    const hist = await getHistory(chatId);
    if (hist.length === 0) return safeSend(chatId, "No history yet.");
    const last = hist.slice(-10);
    const lines = last.map((m) => {
      const who = m.role === "user" ? "👤" : "🤖";
      const preview = (m.content || "").slice(0, 200);
      return `${who} ${escapeForCode(preview)}`;
    });
    return safeSend(chatId, lines.join("\n\n"));
  }

  if (text === "/usage" || text.startsWith("/usage ")) {
    const arg = text === "/usage" ? "" : text.slice(7).trim().toLowerCase();
    return handleUsage(chatId, arg);
  }

  // Direct slash shortcuts that bypass the LLM (cheaper + deterministic)
  if (text.startsWith("/img ")) {
    const prompt = text.slice(5).trim();
    return runDirectTool(chatId, "generate_image", { prompt });
  }
  if (text.startsWith("/say ")) {
    const t = text.slice(5).trim();
    return runDirectTool(chatId, "text_to_speech", { text: t });
  }
  if (text.startsWith("/find ")) {
    const query = text.slice(6).trim();
    return runDirectTool(chatId, "web_search", { query });
  }
  if (text.startsWith("/get ")) {
    const url = text.slice(5).trim();
    return runDirectTool(chatId, "web_fetch", { url });
  }

  // Content generation commands.
  if (text === "/translate" || text.startsWith("/translate ")) {
    return handleTranslate(chatId, text.replace(/^\/translate\s*/, ""));
  }
  if (text === "/summarize" || text.startsWith("/summarize ")) {
    return handleSummarize(chatId, text.replace(/^\/summarize\s*/, ""));
  }
  if (text === "/post" || text.startsWith("/post ")) {
    return handlePost(chatId, text.replace(/^\/post\s*/, ""));
  }
  if (text === "/script" || text.startsWith("/script ")) {
    return handleScript(chatId, text.replace(/^\/script\s*/, ""));
  }
  if (text === "/idea" || text.startsWith("/idea ")) {
    return handleIdea(chatId, text.replace(/^\/idea\s*/, ""));
  }
  if (text === "/setlang" || text.startsWith("/setlang ")) {
    return handleSetLang(chatId, text.replace(/^\/setlang\s*/, ""));
  }

  if (text === "/song" || text.startsWith("/song ")) {
    return handleSong(chatId, text.replace(/^\/song\s*/, ""));
  }

  if (text === "/digest" || text.startsWith("/digest ")) {
    return handleDigest(chatId, text.replace(/^\/digest\s*/, ""));
  }

  if (text.startsWith("/")) {
    return safeSend(chatId, `Unknown command. Send <code>/help</code> for the list.`);
  }

  // Plain text → agentic chat (model + tool calls)
  await chat(chatId, text);
}

// ─── Direct (deterministic) tool execution ─────────────────────────────────
async function runDirectTool(chatId, name, args) {
  if (!args || (typeof args === "object" && Object.values(args).every((v) => !v))) {
    return safeSend(chatId, `Usage missing argument.`);
  }
  await telegram.sendChatAction(chatId, name === "text_to_speech" ? "upload_voice" : (name === "generate_image" ? "upload_photo" : "typing")).catch(() => {});
  const result = await executeToolCall(name, args);
  await deliverToolResult(chatId, result);
}

async function deliverToolResult(chatId, result) {
  if (!result) return;
  if (result.type === "photo") {
    return safeSendPhoto(chatId, result.buffer, result.caption || "");
  }
  if (result.type === "audio") {
    return safeSendAudio(chatId, result.buffer, result);
  }
  if (result.type === "error") {
    return safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(result.message)}</code>`);
  }
  // text
  const html = toTelegramHtml(result.text || "");
  for (const part of splitForTelegram(html)) {
    await safeSend(chatId, part);
  }
}

// ─── Agentic chat with tool-calling loop ───────────────────────────────────
async function chat(chatId, userText) {
  const model = await getDefaultModel(chatId);
  const history = await getHistory(chatId);

  // Build messages: system + remembered turns + new user message
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userText },
  ];

  await telegram.sendChatAction(chatId, "typing").catch(() => {});

  const apiKey = process.env.GATEWAY_API_KEY;
  if (!apiKey) throw new Error("GATEWAY_API_KEY not set");

  const baseUrl = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 20128}`;

  // Persist user message immediately so memory survives mid-loop crashes
  await appendMessage(chatId, "user", userText);

  let finalText = "";

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        tools: toolDefinitions(),
        tool_choice: "auto",
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`gateway ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    if (!message) {
      finalText = "(empty response)";
      break;
    }

    // No tool calls → final assistant turn
    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      finalText = message.content || "";
      break;
    }

    // Append the assistant turn (with tool_calls) to messages so the model can see its own intent
    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: toolCalls,
    });

    // Show the user a brief "doing X" signal while we work
    await telegram.sendChatAction(chatId, "typing").catch(() => {});

    // Execute each tool call serially (most are I/O-bound, ordering rarely matters)
    for (const tc of toolCalls) {
      const name = tc?.function?.name;
      const argsJson = tc?.function?.arguments || "{}";
      const id = tc?.id;
      const result = await executeToolCall(name, argsJson);

      // Side-effect deliveries (photo/audio) go straight to the user before the
      // next model turn — feels live. Text/error becomes the tool message.
      let toolReplyText = "";
      if (result.type === "photo") {
        await safeSendPhoto(chatId, result.buffer, result.caption || "");
        toolReplyText = `(image sent successfully)`;
      } else if (result.type === "audio") {
        await safeSendAudio(chatId, result.buffer, result);
        toolReplyText = `(audio sent successfully)`;
      } else if (result.type === "error") {
        toolReplyText = `Error: ${result.message}`;
      } else {
        toolReplyText = result.text || "";
      }

      messages.push({
        role: "tool",
        tool_call_id: id,
        content: toolReplyText.slice(0, 8000), // cap to keep context lean
      });
    }
    // loop continues — model gets to react to the tool outputs
  }

  if (finalText) {
    await appendMessage(chatId, "assistant", finalText);
    const html = toTelegramHtml(finalText);
    for (const part of splitForTelegram(html)) {
      await safeSend(chatId, part);
    }
  }
}

async function listModelsByKind(chatId, kind) {
  const validKinds = new Set(["image", "tts", "stt", "embedding", "imageToText", "imagetotext", "image-to-text", "search", "fetch", "video", "music", "llm"]);
  const k = kind || "image";
  if (!validKinds.has(k)) {
    return safeSend(chatId, `Unknown kind. Try one of: <code>image, tts, stt, embedding, imageToText, llm</code>`);
  }
  try {
    const apiKey = process.env.GATEWAY_API_KEY;
    const base = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 20128}`;
    const res = await fetch(`${base}/v1/models/${k}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return safeSend(chatId, `Couldn't list <code>${k}</code> models (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const ids = (data?.data || []).map((m) => m.id);
    if (ids.length === 0) {
      return safeSend(chatId, `No <code>${escapeForCode(k)}</code> models available. Connect a provider for this capability in the dashboard.`);
    }
    const head = `<b>${escapeForCode(k)} models</b> (${ids.length})`;
    const body = ids.map((id) => `<code>${escapeForCode(id)}</code>`).join("\n");
    for (const part of splitForTelegram(`${head}\n\n${body}`)) {
      await safeSend(chatId, part);
    }
  } catch (e) {
    await safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function showProviderStatus(chatId) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  try {
    const [connections, summary] = await Promise.all([
      getProviderConnections().catch(() => []),
      getTodaySummary().catch(() => ({ byProvider: [], totalRequests: 0 })),
    ]);

    if (!connections.length) {
      return safeSend(chatId, "No provider connections found. Open the dashboard to add one.");
    }

    // Group connections by provider id, count accounts.
    const byProvider = {};
    for (const c of connections) {
      const pid = c.provider || "unknown";
      byProvider[pid] ||= { id: pid, accounts: 0, names: new Set() };
      byProvider[pid].accounts++;
      if (c.name || c.email) byProvider[pid].names.add(c.name || c.email);
    }

    // Match against today's usage to flag who's actually being hit.
    const usageByProvider = new Map();
    for (const p of summary.byProvider || []) {
      usageByProvider.set((p.provider || "").toLowerCase(), p);
    }

    const rows = Object.values(byProvider)
      .map((p) => {
        const meta = AI_PROVIDERS[p.id];
        const niceName = meta?.name || p.id;
        const usage = usageByProvider.get(niceName.toLowerCase()) || usageByProvider.get(p.id);
        const todayTokens = usage?.tokens || 0;
        const todayReqs = usage?.requests || 0;
        return { id: p.id, niceName, accounts: p.accounts, todayTokens, todayReqs };
      })
      .sort((a, b) => b.todayTokens - a.todayTokens || a.niceName.localeCompare(b.niceName));

    const lines = [
      `<b>Connected providers</b> (${rows.length})`,
      "",
      ...rows.map((r) => {
        const used = r.todayTokens > 0
          ? `${formatNum(r.todayReqs)} req · ${formatNum(r.todayTokens)} tokens today`
          : "<i>idle today</i>";
        const accts = r.accounts > 1 ? ` · ${r.accounts} accounts` : "";
        return `• <b>${escapeForCode(r.niceName)}</b>${accts}\n  ${used}`;
      }),
      "",
      "<i>Note: providers without recent activity may still be healthy. The bot auto-fails over for image/TTS if a quota is hit.</i>",
    ];

    for (const part of splitForTelegram(lines.join("\n"))) {
      await safeSend(chatId, part);
    }
  } catch (e) {
    await safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

// ─── /translate /summarize /post /script /idea /setlang ───────────────────

const LANG_KV_SCOPE = (chatId) => `tg_state:${chatId}`;
async function getChatLang(chatId) {
  try {
    const a = await getAdapter();
    const row = a.get("SELECT value FROM kv WHERE scope = ? AND key = 'lang'", [LANG_KV_SCOPE(chatId)]);
    return row?.value || null;
  } catch { return null; }
}
async function setChatLang(chatId, lang) {
  const a = await getAdapter();
  a.run("INSERT OR REPLACE INTO kv (scope, key, value) VALUES (?, 'lang', ?)", [LANG_KV_SCOPE(chatId), lang]);
}

async function handleSetLang(chatId, arg) {
  const lang = String(arg || "").trim().toLowerCase();
  if (!lang) {
    const cur = await getChatLang(chatId);
    return safeSend(chatId, `Default language: <code>${escapeForCode(cur || "(none — auto)")}</code>\nSet with: <code>/setlang en</code>, <code>/setlang vi</code>, <code>/setlang zh</code>, etc.`);
  }
  await setChatLang(chatId, lang);
  return safeSend(chatId, `Default language set to <code>${escapeForCode(languageName(lang) || lang)}</code>`);
}

async function handleTranslate(chatId, raw) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  const input = String(raw || "").trim();
  if (!input) {
    return safeSend(chatId, [
      "Usage:",
      "<code>/translate vi Hello world</code> — translate to Vietnamese",
      "<code>/translate Hello world</code> — translate to your default language",
      "<code>/setlang vi</code> — set the default target",
    ].join("\n"));
  }
  // First whitespace-separated token is treated as a lang code if it's 2-5 alpha-or-dash chars and the rest is non-empty.
  const m = input.match(/^([a-zA-Z][a-zA-Z-]{1,4})\s+(.+)$/s);
  let target;
  let body;
  if (m && (languageName(m[1].toLowerCase()) || m[1].length <= 3)) {
    target = m[1].toLowerCase();
    body = m[2];
  } else {
    target = (await getChatLang(chatId)) || "en";
    body = input;
  }
  try {
    const { content, model } = await translate({ chatId, text: body, targetLang: target });
    return safeSend(chatId, `<b>${escapeForCode(languageName(target) || target)}</b>  <i>(${escapeForCode(model)})</i>\n\n${escapeForCode(content)}`);
  } catch (e) {
    return safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handleSummarize(chatId, raw) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  const input = String(raw || "").trim();
  if (!input) {
    return safeSend(chatId, [
      "Usage:",
      "<code>/summarize &lt;text&gt;</code>",
      "<code>/summarize https://example.com/article</code>",
      "Add <code>--style short</code> | <code>--style long</code> | <code>--style eli5</code>",
    ].join("\n"));
  }
  const { rest, flags } = parseFlags(input, ["style", "lang"]);
  const lang = flags.lang || (await getChatLang(chatId)) || null;
  const style = flags.style || "default";

  let textToSummarize = rest;
  // If the input starts with a URL, fetch it first via the existing tool.
  const urlMatch = rest.match(/^(https?:\/\/\S+)\s*$/i);
  if (urlMatch) {
    const fetchRes = await executeToolCall("web_fetch", { url: urlMatch[1], format: "text", max_chars: 18000 });
    if (fetchRes.type === "error") {
      return safeSend(chatId, `<b>Error fetching URL:</b> <code>${escapeForCode(fetchRes.message)}</code>`);
    }
    textToSummarize = fetchRes.text || "";
    if (!textToSummarize) {
      return safeSend(chatId, "Fetched the URL but got no readable text.");
    }
  }
  try {
    const { content, model } = await summarize({ chatId, text: textToSummarize, style, lang });
    const head = urlMatch ? `<b>Summary of</b> <code>${escapeForCode(urlMatch[1])}</code>` : "<b>Summary</b>";
    return safeSend(chatId, `${head}  <i>(${escapeForCode(model)})</i>\n\n${escapeForCode(content)}`);
  } catch (e) {
    return safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handlePost(chatId, raw) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  const input = String(raw || "").trim();
  if (!input) {
    return safeSend(chatId, [
      "Usage:",
      "<code>/post twitter &lt;topic&gt;</code>",
      "<code>/post linkedin &lt;topic&gt;</code>",
      "<code>/post fb &lt;topic&gt;</code>",
      "<code>/post ig &lt;topic&gt;</code>",
      "<code>/post tiktok &lt;topic&gt;</code>",
      "<code>/post thread &lt;topic&gt;</code> — 5-7 tweet thread",
      "",
      `Platforms: ${platformList().join(", ")}`,
      "Add <code>--tone witty</code> | <code>--tone professional</code> | <code>--lang vi</code>",
    ].join("\n"));
  }
  const { rest, flags } = parseFlags(input, ["tone", "lang"]);
  const m = rest.match(/^(\S+)\s+(.+)$/s);
  if (!m) {
    return safeSend(chatId, "Usage: <code>/post &lt;platform&gt; &lt;topic&gt;</code>\nSee <code>/post</code> for the full list.");
  }
  const [, platform, topic] = m;
  const lang = flags.lang || (await getChatLang(chatId)) || null;

  try {
    const { content, model } = await generatePost({ chatId, platform, topic, tone: flags.tone, lang });

    // For /post thread, split on the '---' separator and send each as its own message.
    if (platform.toLowerCase() === "thread") {
      const tweets = content.split(/\n-{3,}\n/).map((t) => t.trim()).filter(Boolean);
      await safeSend(chatId, `<b>Twitter/X thread</b>  <i>(${escapeForCode(model)})</i>  — copy each block separately:`);
      for (const t of tweets) {
        await safeSend(chatId, `<pre>${escapeForCode(t)}</pre>`);
      }
      return;
    }

    // Single platform: send as one <pre> block so long-press → Copy works cleanly.
    return safeSend(chatId, `<b>${escapeForCode(platform)}</b>  <i>(${escapeForCode(model)})</i>\n\n<pre>${escapeForCode(content)}</pre>`);
  } catch (e) {
    return safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handleScript(chatId, raw) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  const input = String(raw || "").trim();
  if (!input) {
    return safeSend(chatId, [
      "Usage:",
      "<code>/script hook &lt;topic&gt;</code>     — 5-second hook",
      "<code>/script 30s &lt;topic&gt;</code>      — 30-second short",
      "<code>/script 60s &lt;topic&gt;</code>      — 60-second short",
      "<code>/script 3min &lt;topic&gt;</code>     — 3-minute YouTube",
    ].join("\n"));
  }
  const { rest, flags } = parseFlags(input, ["lang"]);
  const m = rest.match(/^(\S+)\s+(.+)$/s);
  if (!m) {
    return safeSend(chatId, "Usage: <code>/script &lt;type&gt; &lt;topic&gt;</code>");
  }
  const [, type, topic] = m;
  const lang = flags.lang || (await getChatLang(chatId)) || null;
  try {
    const { content, model } = await generateScript({ chatId, type, topic, lang });
    return safeSend(chatId, `<b>Script (${escapeForCode(type)})</b>  <i>(${escapeForCode(model)})</i>\n\n<pre>${escapeForCode(content)}</pre>`);
  } catch (e) {
    return safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handleIdea(chatId, raw) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  const input = String(raw || "").trim();
  if (!input) {
    return safeSend(chatId, "Usage: <code>/idea &lt;niche or topic&gt;</code>\nExample: <code>/idea solo founder marketing</code>");
  }
  const { rest, flags } = parseFlags(input, ["count", "lang"]);
  const count = Math.min(Math.max(parseInt(flags.count || "5", 10) || 5, 1), 12);
  const lang = flags.lang || (await getChatLang(chatId)) || null;
  try {
    const { content, model } = await generateIdeas({ chatId, niche: rest, count, lang });
    return safeSend(chatId, `<b>${count} ideas — ${escapeForCode(rest)}</b>  <i>(${escapeForCode(model)})</i>\n\n${escapeForCode(content)}`);
  } catch (e) {
    return safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handleUsage(chatId, mode) {
  await telegram.sendChatAction(chatId, "upload_photo").catch(() => {});

  // /usage detail or /usage text → no chart, just summary
  if (mode === "detail" || mode === "text") {
    const s = await getTodaySummary();
    const lines = [
      `<b>Today</b> — ${formatNum(s.totalRequests)} req, ${formatNum(s.totalTokens)} tokens, ${formatCost(s.totalCost)}`,
      "",
      "<b>By provider</b>",
      ...(s.byProvider.length === 0
        ? ["(none yet)"]
        : s.byProvider.map((p) => `• ${escapeForCode(p.provider)}: ${formatNum(p.tokens)} tokens · ${p.requests} req · ${formatCost(p.cost)}`)),
    ];
    return safeSend(chatId, lines.join("\n"));
  }

  // /usage today → bar chart per provider
  if (mode === "today") {
    const s = await getTodaySummary();
    if (s.byProvider.length === 0) {
      return safeSend(chatId, "No usage today yet.");
    }
    const png = await renderTokensByProvider(s.byProvider, { title: "Tokens by provider — today" });
    const caption = `<b>Today</b>\n${formatNum(s.totalRequests)} req · ${formatNum(s.totalTokens)} tokens · ${formatCost(s.totalCost)}`;
    return safeSendPhoto(chatId, png, caption);
  }

  // /usage week → multi-line per-provider chart
  if (mode === "week" || mode === "7d") {
    const { providers, labels } = await getWeekByProvider();
    if (providers.length === 0) {
      return safeSend(chatId, "No usage in the last 7 days.");
    }
    const png = await renderProvidersOverTime(providers, labels, { title: "Tokens per provider — last 7 days" });
    return safeSendPhoto(chatId, png, "<b>Last 7 days</b>");
  }

  // /usage (default) → today's totals + a 7-day stacked bar chart
  const todayP = getTodaySummary();
  const weekP = getWeekDailyTokens();
  const [today, week] = await Promise.all([todayP, weekP]);

  const caption = [
    `<b>Today</b>`,
    `${formatNum(today.totalRequests)} req · ${formatNum(today.totalTokens)} tokens · ${formatCost(today.totalCost)}`,
    "",
    today.byProvider.length === 0
      ? "(no usage today)"
      : today.byProvider.slice(0, 5).map((p) => `${escapeForCode(p.provider)}: ${formatNum(p.tokens)}`).join(" · "),
  ].join("\n");

  if (week.length === 0 || week.every((d) => d.totalTokens === 0)) {
    return safeSend(chatId, caption);
  }

  const png = await renderDailyTokens(week, { title: "Tokens — last 7 days" });
  return safeSendPhoto(chatId, png, caption);
}

async function countActiveProviders() {
  try {
    const list = await buildModelsList(["llm"]);
    const owners = new Set(list.map((m) => m.owned_by).filter(Boolean));
    return owners.size;
  } catch {
    return 0;
  }
}

function escapeForCode(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── /digest command ───────────────────────────────────────────────────────

async function handleDigest(chatId, raw) {
  const arg = String(raw || "").trim().toLowerCase();
  const config = await getDigestConfig(chatId);

  // /digest (no args) → show current status
  if (!arg) {
    const status = config.enabled ? "✅ ON" : "❌ OFF";
    const localHour = config.hour || 7;
    const tz = config.timezone || 0;
    const tzLabel = tz >= 0 ? `UTC+${tz}` : `UTC${tz}`;
    const topics = (config.topics || []).join(", ") || "tech, ai";
    const weather = config.weather || "(not set)";

    return safeSend(chatId, [
      `<b>📅 Daily Digest</b> ${status}`,
      "",
      `⏰ Time: <b>${localHour}:00</b> (${tzLabel})`,
      `📰 Topics: <code>${escapeForCode(topics)}</code>`,
      `🌤️ Weather: <code>${escapeForCode(weather)}</code>`,
      `🌐 Language: <code>${escapeForCode(config.language || "auto")}</code>`,
      "",
      "<b>Commands:</b>",
      "<code>/digest on</code> — enable daily digest",
      "<code>/digest off</code> — disable",
      "<code>/digest now</code> — send one right now",
      "<code>/digest time 8</code> — set hour (0-23)",
      "<code>/digest tz +7</code> — set timezone (UTC offset)",
      "<code>/digest topics ai,crypto,startups</code>",
      "<code>/digest weather Phnom Penh</code>",
      "<code>/digest lang vi</code> — set output language",
    ].join("\n"));
  }

  // /digest on
  if (arg === "on" || arg === "enable") {
    config.enabled = true;
    await setDigestConfig(chatId, config);
    const tz = config.timezone || 0;
    const tzLabel = tz >= 0 ? `UTC+${tz}` : `UTC${tz}`;
    return safeSend(chatId, `✅ Daily digest enabled! You'll receive it at <b>${config.hour || 7}:00</b> (${tzLabel}) every day.`);
  }

  // /digest off
  if (arg === "off" || arg === "disable") {
    config.enabled = false;
    await setDigestConfig(chatId, config);
    return safeSend(chatId, "❌ Daily digest disabled.");
  }

  // /digest now — send immediately
  if (arg === "now" || arg === "test") {
    await safeSend(chatId, "<i>Generating your digest...</i>");
    await triggerDigestNow(chatId, config);
    return;
  }

  // /digest time <hour>
  if (arg.startsWith("time ")) {
    const hour = parseInt(arg.slice(5).trim(), 10);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      return safeSend(chatId, "Hour must be 0-23. Example: <code>/digest time 8</code>");
    }
    config.hour = hour;
    await setDigestConfig(chatId, config);
    return safeSend(chatId, `⏰ Digest time set to <b>${hour}:00</b>`);
  }

  // /digest tz <offset>
  if (arg.startsWith("tz ")) {
    const raw = arg.slice(3).trim().replace(/^utc/i, "");
    const tz = parseInt(raw, 10);
    if (isNaN(tz) || tz < -12 || tz > 14) {
      return safeSend(chatId, "Timezone offset must be -12 to +14. Example: <code>/digest tz +7</code>");
    }
    config.timezone = tz;
    await setDigestConfig(chatId, config);
    const label = tz >= 0 ? `UTC+${tz}` : `UTC${tz}`;
    return safeSend(chatId, `🌍 Timezone set to <b>${label}</b>`);
  }

  // /digest topics <comma-separated>
  if (arg.startsWith("topics ")) {
    const topics = arg.slice(7).split(",").map((t) => t.trim()).filter(Boolean);
    if (topics.length === 0) {
      return safeSend(chatId, "Provide comma-separated topics. Example: <code>/digest topics ai,crypto,startups</code>");
    }
    config.topics = topics.slice(0, 5); // max 5 topics
    await setDigestConfig(chatId, config);
    return safeSend(chatId, `📰 Digest topics: <code>${escapeForCode(config.topics.join(", "))}</code>`);
  }

  // /digest weather <city>
  if (arg.startsWith("weather ")) {
    const city = raw.slice(8).trim(); // use original case from `raw`
    if (!city) {
      return safeSend(chatId, "Example: <code>/digest weather Phnom Penh</code>");
    }
    config.weather = city;
    await setDigestConfig(chatId, config);
    return safeSend(chatId, `🌤️ Weather city set to <b>${escapeForCode(city)}</b>`);
  }

  // /digest lang <code>
  if (arg.startsWith("lang ")) {
    const lang = arg.slice(5).trim();
    config.language = lang || null;
    await setDigestConfig(chatId, config);
    return safeSend(chatId, `🌐 Digest language: <b>${escapeForCode(lang || "auto")}</b>`);
  }

  return safeSend(chatId, "Unknown digest option. Send <code>/digest</code> to see all options.");
}

// ─── Media handlers: photo, document, voice ────────────────────────────────

async function handlePhoto(chatId, msg) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});

  const fileId = getBestPhotoFileId(msg.photo);
  if (!fileId) {
    return safeSend(chatId, "Couldn't get the photo. Try sending it again.");
  }

  const caption = (msg.caption || "").trim();
  await safeSend(chatId, "<i>Analyzing image...</i>");

  try {
    const { buffer } = await downloadTelegramFile(fileId);
    const { text, model } = await analyzeImage(chatId, buffer, caption);

    // Save to conversation memory
    const userMsg = caption ? `[Sent a photo] ${caption}` : "[Sent a photo for analysis]";
    await appendMessage(chatId, "user", userMsg);
    await appendMessage(chatId, "assistant", text);

    const html = toTelegramHtml(text);
    const header = `<i>(${escapeForCode(model)})</i>\n\n`;
    for (const part of splitForTelegram(header + html)) {
      await safeSend(chatId, part);
    }
  } catch (e) {
    await safeSend(chatId, `<b>Vision error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handleDocument(chatId, msg) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});

  const doc = msg.document;
  const fileName = doc.file_name || "unknown";
  const mimeType = doc.mime_type || "application/octet-stream";
  const fileSize = doc.file_size || 0;

  // Telegram Bot API limit: 20MB for downloads
  if (fileSize > 20 * 1024 * 1024) {
    return safeSend(chatId, "File is too large (max 20MB for Telegram bot downloads).");
  }

  const caption = (msg.caption || "").trim();
  await safeSend(chatId, `<i>Reading ${escapeForCode(fileName)}...</i>`);

  try {
    const { buffer } = await downloadTelegramFile(doc.file_id);
    const { text, model } = await analyzeDocument(chatId, buffer, fileName, mimeType, caption);

    // Save to conversation memory
    const userMsg = caption
      ? `[Sent file: ${fileName}] ${caption}`
      : `[Sent file: ${fileName} for analysis]`;
    await appendMessage(chatId, "user", userMsg);
    await appendMessage(chatId, "assistant", text);

    const html = toTelegramHtml(text);
    const header = model === "system" ? "" : `<i>(${escapeForCode(model)})</i>\n\n`;
    for (const part of splitForTelegram(header + html)) {
      await safeSend(chatId, part);
    }
  } catch (e) {
    await safeSend(chatId, `<b>File error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

async function handleVoice(chatId, msg) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});

  const voice = msg.voice || msg.audio;
  const fileId = voice.file_id;
  const mimeType = voice.mime_type || "audio/ogg";

  try {
    const { buffer } = await downloadTelegramFile(fileId);
    const transcription = await transcribeVoice(buffer, mimeType);

    if (!transcription) {
      // No STT provider available — inform user
      return safeSend(chatId, [
        "<b>No speech-to-text provider configured.</b>",
        "",
        "Connect an STT provider in the dashboard to enable voice messages.",
        "Supported: OpenAI Whisper, Groq Whisper, Deepgram, etc.",
      ].join("\n"));
    }

    // Show transcription to user, then process as normal chat
    await safeSend(chatId, `<i>You said:</i> "${escapeForCode(transcription)}"`);

    // Process the transcribed text through the normal chat pipeline
    await handle(chatId, transcription);
  } catch (e) {
    await safeSend(chatId, `<b>Voice error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

// ─── /song command ─────────────────────────────────────────────────────────

async function handleSong(chatId, raw) {
  await telegram.sendChatAction(chatId, "typing").catch(() => {});
  const input = String(raw || "").trim();

  if (!input) {
    return safeSend(chatId, [
      "<b>Usage:</b>",
      "<code>/song &lt;topic&gt;</code>",
      "<code>/song --genre pop --mood happy Love in the rain</code>",
      "<code>/song --lang vi Coding all night</code>",
      "",
      "<b>Options:</b>",
      "<code>--genre</code>  pop, rock, hiphop, rnb, jazz, edm, country, lofi, ballad...",
      "<code>--mood</code>   happy, sad, energetic, chill, romantic, angry, nostalgic...",
      "<code>--lang</code>   en, vi, ja, ko, zh, es, fr...",
    ].join("\n"));
  }

  const { rest, flags } = parseFlags(input, ["genre", "mood", "lang"]);

  if (!rest) {
    return safeSend(chatId, "Give me a topic! Example: <code>/song Love under the moonlight</code>");
  }

  try {
    const { text: lyrics, model } = await generateSong(chatId, {
      topic: rest,
      genre: flags.genre || null,
      mood: flags.mood || null,
      language: flags.lang || null,
    });

    const header = `<b>Song</b>  <i>(${escapeForCode(model)})</i>\n\n`;
    const html = toTelegramHtml(lyrics);
    for (const part of splitForTelegram(header + html)) {
      await safeSend(chatId, part);
    }

    // Try to generate audio if a music model is available
    const audioBuffer = await generateSongAudio(chatId, lyrics, flags.genre).catch(() => null);
    if (audioBuffer && audioBuffer.length > 0) {
      await safeSendAudio(chatId, audioBuffer, {
        mime: "audio/mpeg",
        filename: "song.mp3",
        caption: `<b>${escapeForCode(rest.slice(0, 60))}</b>${flags.genre ? ` (${escapeForCode(flags.genre)})` : ""}`,
      });
    }
  } catch (e) {
    await safeSend(chatId, `<b>Error:</b> <code>${escapeForCode(e?.message || String(e))}</code>`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function safeSend(chatId, html) {
  try {
    await telegram.sendMessage(chatId, html);
  } catch (e) {
    console.error("[telegram] sendMessage failed:", e?.message);
  }
}

async function safeSendPhoto(chatId, pngBuffer, caption) {
  try {
    await telegram.sendPhoto(chatId, pngBuffer, { caption });
  } catch (e) {
    console.error("[telegram] sendPhoto failed:", e?.message);
    await safeSend(chatId, `${caption}\n\n<i>(photo send failed: ${escapeForCode(e?.message || "unknown")})</i>`);
  }
}

async function safeSendAudio(chatId, buffer, opts) {
  try {
    await telegram.sendAudio(chatId, buffer, {
      mime: opts?.mime || "audio/mpeg",
      filename: opts?.filename || "speech.mp3",
      caption: opts?.caption || "",
    });
  } catch (e) {
    console.error("[telegram] sendAudio failed:", e?.message);
    await safeSend(chatId, `<i>(audio send failed: ${escapeForCode(e?.message || "unknown")})</i>`);
  }
}
