import { getPricing, getSettings, updateSettings, updatePricing } from "@/lib/localDb";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

const SOURCE_URL = "https://opencode.ai/docs/zh-cn/go/";
const MODEL_IDS = {
  "Grok 4.5": "grok-4.5",
  "GPT 5.6 Luna": "gpt-5.6-luna",
  "GLM-5.3": "glm-5.3",
  "GLM-5.2": "glm-5.2",
  "GLM-5.1": "glm-5.1",
  "Kimi K3": "kimi-k3",
  "Kimi K2.7 Code": "kimi-k2.7-code",
  "Kimi K2.6": "kimi-k2.6",
  "MiMo V2.5": "mimo-v2.5",
  "MiMo-V2.5": "mimo-v2.5",
  "MiMo V2.5 Pro": "mimo-v2.5-pro",
  "MiMo-V2.5-Pro": "mimo-v2.5-pro",
  "MiniMax M3": "minimax-m3",
  "MiniMax M2.7": "minimax-m2.7",
  "MiniMax M2.5": "minimax-m2.5",
  "Muse Spark 1.2 Contributor": "muse-spark-1.2-contributor",
  "Qwen3.8 Max": "qwen3.8-max",
  "Qwen3.7 Max": "qwen3.7-max",
  "Qwen3.7 Plus": "qwen3.7-plus",
  "Qwen3.6 Plus": "qwen3.6-plus",
  "DeepSeek V4 Pro": "deepseek-v4-pro",
  "DeepSeek V4 Flash": "deepseek-v4-flash",
  "DeepSeek V4 Flash Vision Exp": "deepseek-v4-flash-vision-exp",
  Hy3: "hy3",
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parsePrice(value) {
  const match = String(value || "").replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : null;
}

function stripVariant(name) {
  return name.replace(/\s+\((?:≤|>|Off-Peak|Peak).*$/, "").trim();
}

const OPENCODE_PEAK_WINDOWS_UTC = "01:00-04:00,06:00-10:00";

function parseTimeMinute(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatTimeMinute(value) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function shiftPricingWindows(windows, offsetMinutes) {
  return String(windows || "")
    .split(/[,，\n]+/)
    .map((window) => {
      const [startValue, endValue] = window.split(/[-~～—]/).map((part) => part.trim());
      const start = parseTimeMinute(startValue);
      const end = parseTimeMinute(endValue);
      if (start == null || end == null || start === end) return "";
      return `${formatTimeMinute(start + offsetMinutes)}-${formatTimeMinute(end + offsetMinutes)}`;
    })
    .filter(Boolean)
    .join(",");
}

const OPENCODE_PEAK_WINDOWS_CHINA = shiftPricingWindows(OPENCODE_PEAK_WINDOWS_UTC, 8 * 60);

function parseRowPricing(row) {
  const input = parsePrice(row[1]);
  const output = parsePrice(row[2]);
  const cached = parsePrice(row[3]);
  const cache_creation = parsePrice(row[4]);
  if (input == null || output == null || cached == null) return null;
  return { input, output, cached, ...(cache_creation == null ? {} : { cache_creation }) };
}

export function parseOpenCodePricing(html) {
  const table = [...String(html || "").matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .map((match) => match[0])
    .find((candidate) => /缓存读取/i.test(decodeHtml(candidate)) && /缓存写入/i.test(decodeHtml(candidate)));
  if (!table) throw new Error("OpenCode pricing table not found");
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => decodeHtml(cell[1].replace(/<[^>]+>/g, "").trim())))
    .filter((cells) => cells.length >= 5);
  const pricing = {};
  const tiered = {};
  for (const row of rows) {
    const modelName = stripVariant(row[0]);
    const model = MODEL_IDS[modelName];
    const rowPricing = parseRowPricing(row);
    if (!model || !rowPricing) continue;
    const variant = row[0].match(/\((Off-Peak|Peak)\)\s*$/i)?.[1]?.toLowerCase();
    if (variant) {
      tiered[model] ||= {};
      tiered[model][variant === "peak" ? "peakPricing" : "offPeakPricing"] = rowPricing;
    } else if (!pricing[model]) {
      pricing[model] = rowPricing;
    }
  }
  for (const [model, tiers] of Object.entries(tiered)) {
    if (!tiers.peakPricing || !tiers.offPeakPricing) continue;
    pricing[model] = {
      ...tiers.peakPricing,
      peakEnabled: true,
      peakWindows: OPENCODE_PEAK_WINDOWS_CHINA,
      peakPricing: tiers.peakPricing,
      offPeakPricing: tiers.offPeakPricing,
    };
  }
  if (!Object.keys(pricing).length) throw new Error("No supported model prices found");
  return pricing;
}

export async function syncPricingFromOpenCode() {
  const now = new Date().toISOString();
  try {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    const sourcePricing = parseOpenCodePricing(await response.text());
    const currentPricing = await getPricing();
    const settings = await getSettings();
    const deleted = new Set(settings.deletedPricingModels || []);
    const existingModels = new Set([
      ...(PROVIDER_MODELS["opencode-go"] || []).map((model) => typeof model === "string" ? model : model?.id).filter(Boolean),
      ...Object.keys(currentPricing["opencode-go"] || {}),
    ]);
    const pricing = {};
    for (const [model, values] of Object.entries(sourcePricing)) {
      if (!existingModels.has(model)) continue;
      pricing[model] = { ...(currentPricing["opencode-go"]?.[model] || {}), ...values };
      deleted.delete(`opencode-go\u0000${model}`);
    }
    if (Object.keys(pricing).length) await updatePricing({ "opencode-go": pricing });
    await updateSettings({
      deletedPricingModels: [...deleted],
      pricingLastSyncAt: now,
      pricingLastSyncStatus: "success",
      pricingLastSyncError: "",
    });
    return {
      provider: "opencode-go",
      pricing,
      updatedCount: Object.keys(pricing).length,
      skippedCount: Object.keys(sourcePricing).length - Object.keys(pricing).length,
      source: SOURCE_URL,
      syncedAt: now,
    };
  } catch (error) {
    await updateSettings({ pricingLastSyncAt: now, pricingLastSyncStatus: "error", pricingLastSyncError: error.message });
    throw error;
  }
}

const globalState = global.__pricingAutoSync ??= { timer: null, intervalHours: 24 };

export async function configurePricingAutoSync(settings = null) {
  const current = settings || await getSettings();
  if (globalState.timer) clearInterval(globalState.timer);
  globalState.timer = null;
  globalState.intervalHours = Math.max(1, Number(current.pricingAutoSyncIntervalHours) || 24);
  if (current.pricingAutoSyncEnabled) {
    const intervalMs = globalState.intervalHours * 60 * 60 * 1000;
    globalState.timer = setInterval(() => syncPricingFromOpenCode().catch(() => {}), intervalMs);
    globalState.timer.unref?.();
  }
}

export async function startPricingAutoSync() {
  const settings = await getSettings();
  await configurePricingAutoSync(settings);
  if (settings.pricingAutoSyncEnabled && settings.pricingLastSyncStatus !== "success") {
    syncPricingFromOpenCode().catch(() => {});
  }
}

export const PRICING_SOURCE_URL = SOURCE_URL;
