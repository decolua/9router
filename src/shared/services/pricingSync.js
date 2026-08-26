import { getPricingModels, getSettings, updateSettings, upsertPricingModels } from "@/lib/localDb";

const SOURCE_URL = "https://opencode.ai/docs/zh-cn/go/";

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

function parseTableRows(table) {
  return [...String(table || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
      .map((cell) => decodeHtml(cell[1].replace(/<[^>]+>/g, "").trim())))
    .filter((cells) => cells.length);
}

function normalizeModelName(name) {
  return String(name || "").normalize("NFKC").trim().toLowerCase();
}

function modelNameToId(name) {
  return normalizeModelName(name)
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseModelIds(tables) {
  const modelIds = new Map();
  for (const table of tables) {
    const rows = parseTableRows(table);
    if (!rows[0]?.some((cell) => /(?:模型|model)\s*id/i.test(cell))) continue;
    for (const row of rows.slice(1)) {
      const modelName = String(row[0] || "").trim();
      const modelId = String(row[1] || "").trim();
      if (!modelName || !/^[a-z0-9][a-z0-9._-]*$/i.test(modelId)) continue;
      modelIds.set(normalizeModelName(modelName), modelId);
    }
  }
  return modelIds;
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
  const tables = [...String(html || "").matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((candidate) => /缓存读取/i.test(decodeHtml(candidate)) && /缓存写入/i.test(decodeHtml(candidate)));
  if (!table) throw new Error("OpenCode pricing table not found");
  const rows = parseTableRows(table).filter((cells) => cells.length >= 5);
  const modelIds = parseModelIds(tables);
  const pricing = {};
  const tiered = {};
  for (const row of rows) {
    const modelName = stripVariant(row[0]);
    const model = modelIds.get(normalizeModelName(modelName)) || modelNameToId(modelName);
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

export function hasPricingChanges(currentPricing, sourcePricing) {
  return Object.entries(sourcePricing || {}).some(([field, value]) => (
    JSON.stringify(currentPricing?.[field]) !== JSON.stringify(value)
  ));
}

export async function syncPricingFromOpenCode() {
  const now = new Date().toISOString();
  try {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    const sourcePricing = parseOpenCodePricing(await response.text());
    const currentPricing = await getPricingModels();
    const settings = await getSettings();
    const pricing = {};
    let updatedCount = 0;
    for (const [model, values] of Object.entries(sourcePricing)) {
      if (hasPricingChanges(currentPricing[model], values)) updatedCount += 1;
      pricing[model] = { ...(currentPricing[model] || {}), ...values, source: "opencode" };
    }
    if (Object.keys(pricing).length) await upsertPricingModels(pricing);
    await updateSettings({
      pricingLastSyncAt: now,
      pricingLastSyncStatus: "success",
      pricingLastSyncError: "",
    });
    return {
      provider: "global",
      pricing,
      syncedCount: Object.keys(pricing).length,
      updatedCount,
      skippedCount: 0,
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
