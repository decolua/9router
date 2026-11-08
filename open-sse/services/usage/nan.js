import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export function formatNanUsage(report) {
  const unavailable = { plan: "NaN", message: "NaN quota unavailable: missing or invalid model counters" };
  if (!Array.isArray(report?.models) || !report.models.length) return unavailable;
  const quotas = Object.create(null);
  for (const row of report.models) {
    if (typeof row?.model !== "string" || !row.model.trim() || Object.hasOwn(quotas, row.model)
        || !Number.isSafeInteger(row.tokensUsed) || row.tokensUsed < 0
        || !Number.isSafeInteger(row.cap) || row.cap <= 0) return unavailable;
    const resetAt = row.periodEnd ?? null;
    if (resetAt !== null && (typeof resetAt !== "string" || !Number.isFinite(Date.parse(resetAt)))) return unavailable;
    quotas[row.model] = { used: row.tokensUsed, total: row.cap, resetAt, unit: "tokens" };
  }
  return { plan: "NaN", quotas };
}

export async function getNanUsage(apiKey, proxyOptions) {
  if (!apiKey) return { plan: "NaN", message: "NaN API key missing" };
  const response = await proxyAwareFetch(U("nan").url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
  if (!response.ok) return { plan: "NaN", message: `NaN usage: HTTP ${response.status}` };
  return formatNanUsage(await response.json());
}
