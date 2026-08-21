// Pure data shaping for Telegram usage views. Calls the in-process usage repos
// directly — no HTTP, no auth bridge needed.

import { getUsageStats, getChartData } from "@/lib/db/index.js";

const PROVIDER_NICE = {
  kr: "Kiro",
  cx: "Codex",
  gh: "GitHub Copilot",
  gc: "Google Cloud",
  anthropic: "Anthropic",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  glm: "GLM",
  minimax: "MiniMax",
  deepseek: "Deepseek",
  ollama: "Ollama",
  cursor: "Cursor",
  cline: "Cline",
};

function niceProvider(p) {
  if (!p) return "unknown";
  return PROVIDER_NICE[p] || p;
}

export async function getTodaySummary() {
  const stats = await getUsageStats("today");
  const totalTokens = (stats.totalPromptTokens || 0) + (stats.totalCompletionTokens || 0);
  const byProvider = Object.entries(stats.byProvider || {})
    .map(([k, v]) => ({
      provider: niceProvider(k),
      tokens: (v.promptTokens || 0) + (v.completionTokens || 0),
      requests: v.requests || 0,
      cost: v.cost || 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    totalRequests: stats.totalRequests || 0,
    totalTokens,
    promptTokens: stats.totalPromptTokens || 0,
    completionTokens: stats.totalCompletionTokens || 0,
    totalCost: stats.totalCost || 0,
    byProvider,
  };
}

export async function getWeekDailyTokens() {
  // Returns [{label: 'Mon 12', promptTokens, completionTokens}] for last 7 days.
  const data = await getChartData("7d");
  // getChartData returns daily buckets for 7d period
  return (data?.daily || data || []).map((d) => ({
    label: d.label || d.dateKey || "",
    promptTokens: d.promptTokens || 0,
    completionTokens: d.completionTokens || 0,
    totalTokens: (d.promptTokens || 0) + (d.completionTokens || 0),
  }));
}

export async function getWeekByProvider() {
  // Returns { providers: [{name, points: [...]}], labels: [...] }
  const stats = await getUsageStats("7d");
  // Build a 7-day shell from getChartData for stable date labels
  const chart = await getChartData("7d");
  const buckets = chart?.daily || chart || [];
  const labels = buckets.map((d) => d.label || d.dateKey || "");

  // Day-by-day per provider needs raw history for the period.
  const { getUsageHistory } = await import("@/lib/db/index.js");
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 6);
  const hist = await getUsageHistory({ startDate: cutoff.toISOString() });

  // Group tokens by (provider, dayLabel)
  const byProviderDay = {};
  for (const h of hist) {
    const d = new Date(h.timestamp);
    const labelDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const provider = h.provider || "unknown";
    const tokens = (h.tokens?.prompt_tokens || h.tokens?.input_tokens || 0)
      + (h.tokens?.completion_tokens || h.tokens?.output_tokens || 0);
    byProviderDay[provider] ||= {};
    byProviderDay[provider][labelDate] = (byProviderDay[provider][labelDate] || 0) + tokens;
  }

  // Map labels back to YYYY-MM-DD for indexing — labels in chartData may be 'Mon 12', so build our own.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayKeys = [];
  const niceLabels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dayKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    niceLabels.push(d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }));
  }

  // Top 6 providers by total in the period
  const totals = Object.entries(byProviderDay)
    .map(([p, days]) => ({ p, total: Object.values(days).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const providers = totals.map(({ p }) => ({
    name: niceProvider(p),
    points: dayKeys.map((k) => byProviderDay[p][k] || 0),
  }));

  // void unused to silence linter without removing the var (might add to summary later)
  void stats;
  void buckets;
  void labels;

  return { providers, labels: niceLabels };
}

export function formatNum(n) {
  if (!n) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

export function formatCost(c) {
  if (!c) return "$0.00";
  if (c < 0.01) return "< $0.01";
  return "$" + c.toFixed(2);
}
