// Daily Digest generator for the Telegram bot.
// Compiles a morning briefing: usage stats, trending tech news, weather,
// AI tips, and custom topics the user configures.

import { telegram } from "@/lib/telegram/client.js";
import { getAdapter } from "@/lib/db/driver.js";
import { getTodaySummary, getWeekDailyTokens, formatNum, formatCost } from "@/lib/telegram/usage.js";
import { executeToolCall } from "@/lib/telegram/tools.js";
import { getDefaultModel } from "@/lib/telegram/conversations.js";
import { splitForTelegram } from "@/lib/telegram/formatter.js";

function gatewayBase() {
  return process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 20128}`;
}
function gatewayKey() {
  const k = process.env.GATEWAY_API_KEY;
  if (!k) throw new Error("GATEWAY_API_KEY not set");
  return k;
}

// ─── Digest Configuration (per-chat, stored in kv) ────────────────────────

const SCOPE = (chatId) => `tg_digest:${chatId}`;

export async function getDigestConfig(chatId) {
  const a = await getAdapter();
  const row = a.get("SELECT value FROM kv WHERE scope = ? AND key = 'config'", [SCOPE(chatId)]);
  if (!row?.value) {
    return {
      enabled: false,
      hour: 7,         // 7 AM UTC by default
      timezone: 0,     // UTC offset in hours
      topics: ["tech", "ai"],
      weather: null,   // city name, e.g. "Phnom Penh"
      language: null,  // output language
    };
  }
  try { return JSON.parse(row.value); } catch { return { enabled: false, hour: 7, timezone: 0, topics: ["tech", "ai"], weather: null, language: null }; }
}

export async function setDigestConfig(chatId, config) {
  const a = await getAdapter();
  a.run(
    "INSERT OR REPLACE INTO kv (scope, key, value) VALUES (?, 'config', ?)",
    [SCOPE(chatId), JSON.stringify(config)]
  );
}

// Get all chat IDs that have digest enabled
export async function getEnabledDigestChats() {
  const a = await getAdapter();
  const rows = a.all("SELECT scope, value FROM kv WHERE key = 'config' AND scope LIKE 'tg_digest:%'");
  const results = [];
  for (const row of rows) {
    try {
      const config = JSON.parse(row.value);
      if (config.enabled) {
        const chatId = row.scope.replace("tg_digest:", "");
        results.push({ chatId: Number(chatId), config });
      }
    } catch { /* skip corrupt entries */ }
  }
  return results;
}

// ─── Digest Content Builders ──────────────────────────────────────────────

async function buildUsageSection() {
  try {
    const yesterday = await getYesterdaySummary();
    const week = await getWeekDailyTokens();

    if (!yesterday && (!week || week.length === 0)) {
      return null;
    }

    const lines = ["<b>📊 Usage Summary</b>"];

    if (yesterday) {
      lines.push(
        `Yesterday: ${formatNum(yesterday.totalRequests)} requests · ${formatNum(yesterday.totalTokens)} tokens · ${formatCost(yesterday.totalCost)}`
      );
      if (yesterday.topModel) {
        lines.push(`Top model: <code>${escapeHtml(yesterday.topModel)}</code>`);
      }
    }

    if (week && week.length > 0) {
      const weekTotal = week.reduce((sum, d) => sum + (d.totalTokens || 0), 0);
      const weekReqs = week.reduce((sum, d) => sum + (d.totalRequests || 0), 0);
      if (weekTotal > 0) {
        lines.push(`This week: ${formatNum(weekReqs)} req · ${formatNum(weekTotal)} tokens`);
      }
    }

    return lines.join("\n");
  } catch (e) {
    console.warn("[digest] usage section error:", e.message);
    return null;
  }
}

async function getYesterdaySummary() {
  try {
    const a = await getAdapter();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const rows = a.all(
      "SELECT provider, model, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp LIKE ?",
      [`${dateStr}%`]
    );

    if (!rows || rows.length === 0) return null;

    let totalTokens = 0;
    let totalCost = 0;
    const modelCounts = {};

    for (const r of rows) {
      const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
      totalTokens += tokens;
      totalCost += r.cost || 0;
      const m = r.model || "unknown";
      modelCounts[m] = (modelCounts[m] || 0) + 1;
    }

    const topModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      totalRequests: rows.length,
      totalTokens,
      totalCost,
      topModel,
    };
  } catch {
    return null;
  }
}

async function buildNewsSection(topics, language) {
  try {
    const query = topics.length > 0
      ? `${topics.join(" ")} news today ${new Date().toISOString().slice(0, 10)}`
      : "technology AI news today";

    const result = await executeToolCall("web_search", { query, max_results: 5 });

    if (result.type === "error" || !result.text) {
      return null;
    }

    // Ask LLM to format the raw search results into a clean digest
    const model = await getDefaultModel(null);
    const systemPrompt = [
      "You are a news curator. Given raw search results, create a concise daily briefing.",
      "Format: 3-5 bullet points, each with a bold headline and one-sentence summary.",
      "Keep it scannable and informative. No fluff.",
      language ? `Write in ${language}.` : "",
    ].filter(Boolean).join(" ");

    const res = await fetch(`${gatewayBase()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Summarize these search results into a daily news digest:\n\n${result.text}` },
        ],
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    return `<b>📰 Today's Brief</b>\n${escapeHtml(content)}`;
  } catch (e) {
    console.warn("[digest] news section error:", e.message);
    return null;
  }
}

async function buildWeatherSection(city) {
  if (!city) return null;

  try {
    const result = await executeToolCall("web_search", { query: `weather ${city} today`, max_results: 2 });

    if (result.type === "error" || !result.text) return null;

    // Extract weather info from search results
    const snippet = result.text.slice(0, 500);
    // Simple extraction — just show the first result snippet
    const firstResult = snippet.split("\n\n")[0] || snippet;
    return `<b>🌤️ Weather in ${escapeHtml(city)}</b>\n${escapeHtml(firstResult.replace(/^\d+\.\s*/, "").slice(0, 200))}`;
  } catch {
    return null;
  }
}

async function buildTipSection(language) {
  try {
    const model = await getDefaultModel(null);
    const prompts = [
      "Give me one short, useful AI productivity tip for developers. Max 2 sentences. Be specific and actionable.",
      "Share one lesser-known keyboard shortcut or CLI trick. Max 2 sentences.",
      "Give me one quick tip about saving money with AI APIs. Max 2 sentences.",
      "Share one tip about prompt engineering that saves tokens. Max 2 sentences.",
    ];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    const res = await fetch(`${gatewayBase()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey()}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: language ? `Respond in ${language}. Be concise.` : "Be concise." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        stream: false,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const tip = data?.choices?.[0]?.message?.content;
    if (!tip) return null;

    return `<b>💡 Tip of the Day</b>\n${escapeHtml(tip)}`;
  } catch {
    return null;
  }
}

// ─── Main Digest Builder ──────────────────────────────────────────────────

export async function buildDigest(chatId, config) {
  const sections = [];

  // Greeting
  const hour = new Date().getUTCHours() + (config.timezone || 0);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  sections.push(`<b>${greeting}! 📅 ${dateStr}</b>\n`);

  // Usage stats
  const usage = await buildUsageSection();
  if (usage) sections.push(usage);

  // Weather
  const weather = await buildWeatherSection(config.weather);
  if (weather) sections.push(weather);

  // News
  const news = await buildNewsSection(config.topics || ["tech", "ai"], config.language);
  if (news) sections.push(news);

  // Tip of the day
  const tip = await buildTipSection(config.language);
  if (tip) sections.push(tip);

  // Footer
  sections.push("\n<i>Configure with /digest • Disable with /digest off</i>");

  return sections.join("\n\n");
}

// ─── Send Digest ──────────────────────────────────────────────────────────

export async function sendDigest(chatId, config) {
  try {
    const content = await buildDigest(chatId, config);
    for (const part of splitForTelegram(content)) {
      await telegram.sendMessage(chatId, part);
    }
    console.log(`[digest] Sent to chat ${chatId}`);
  } catch (e) {
    console.error(`[digest] Failed for chat ${chatId}:`, e.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
