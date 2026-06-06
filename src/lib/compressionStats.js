import { getMeta, setMeta } from "./db/helpers/metaStore.js";

const META_KEY = "compressionStats";
const TOOL_IDS = ["rtk", "caveman", "headroom"];
let writeQueue = Promise.resolve();

function estimateTokensSaved(bytesSaved) {
  return Math.round(toNumber(bytesSaved) / 4);
}

function canEstimateTokenSavings(tool, bytesSaved) {
  return tool !== "caveman" && toNumber(bytesSaved) > 0;
}

function emptyToolStats() {
  return {
    requests: 0,
    hits: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    bytesSaved: 0,
    estimatedTokensSaved: 0,
    tokenSavingsAvailable: false,
    lastUsed: null,
    lastDetail: "",
  };
}

function emptyStats() {
  return {
    updatedAt: null,
    tools: Object.fromEntries(TOOL_IDS.map((tool) => [tool, emptyToolStats()])),
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeStats(value) {
  const base = emptyStats();
  const parsed = typeof value === "string" && value
    ? JSON.parse(value)
    : (value && typeof value === "object" ? value : {});

  base.updatedAt = parsed.updatedAt || null;
  for (const tool of TOOL_IDS) {
    const input = parsed.tools?.[tool] || {};
    const bytesSaved = toNumber(input.bytesSaved);
    const tokenSavingsAvailable = typeof input.tokenSavingsAvailable === "boolean"
      ? input.tokenSavingsAvailable
      : canEstimateTokenSavings(tool, bytesSaved);
    base.tools[tool] = {
      requests: toNumber(input.requests),
      hits: toNumber(input.hits),
      bytesBefore: toNumber(input.bytesBefore),
      bytesAfter: toNumber(input.bytesAfter),
      bytesSaved,
      estimatedTokensSaved: tokenSavingsAvailable ? estimateTokensSaved(bytesSaved) : 0,
      tokenSavingsAvailable,
      lastUsed: input.lastUsed || null,
      lastDetail: typeof input.lastDetail === "string" ? input.lastDetail : "",
    };
  }
  return base;
}

export async function getCompressionStats() {
  try {
    return normalizeStats(await getMeta(META_KEY, null));
  } catch {
    return emptyStats();
  }
}

export async function recordCompressionStats(tool, event = {}) {
  if (!TOOL_IDS.includes(tool)) return getCompressionStats();

  const nextWrite = writeQueue.catch(() => {}).then(async () => {
    const stats = await getCompressionStats();
    const target = stats.tools[tool];
    const bytesBefore = toNumber(event.bytesBefore);
    const bytesAfter = toNumber(event.bytesAfter);
    const explicitSaved = event.bytesSaved == null ? null : toNumber(event.bytesSaved);
    const bytesSaved = explicitSaved == null ? Math.max(0, bytesBefore - bytesAfter) : explicitSaved;
    const hits = toNumber(event.hits ?? (bytesSaved > 0 || event.hit ? 1 : 0));
    const requests = toNumber(event.requests ?? 1) || 1;
    const now = new Date().toISOString();

    target.requests += requests;
    target.hits += hits;
    target.bytesBefore += bytesBefore;
    target.bytesAfter += bytesAfter;
    target.bytesSaved += bytesSaved;
    target.tokenSavingsAvailable = canEstimateTokenSavings(tool, target.bytesSaved);
    target.estimatedTokensSaved = target.tokenSavingsAvailable
      ? estimateTokensSaved(target.bytesSaved)
      : 0;
    target.lastUsed = now;
    if (typeof event.detail === "string") target.lastDetail = event.detail;
    stats.updatedAt = now;

    await setMeta(META_KEY, JSON.stringify(stats));
    return stats;
  });

  writeQueue = nextWrite;
  return nextWrite;
}

export async function resetCompressionStats() {
  const stats = emptyStats();
  await setMeta(META_KEY, JSON.stringify(stats));
  return stats;
}
