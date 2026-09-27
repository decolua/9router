import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export function formatNanUsage(report, now = new Date()) {
  const total = report?.totals;
  const all = report?.all_time;
  if (!Array.isArray(total?.by_model) || !Number.isSafeInteger(total?.total_tokens)
      || !Number.isSafeInteger(total?.api_requests) || !Number.isSafeInteger(all?.total_tokens)) {
    return { plan: "NaN", message: "NaN usage response missing totals" };
  }
  const caps = U("nan").monthlyTokenCaps;
  const rows = new Map(total.by_model.filter((row) => typeof row?.model === "string").map((row) => [row.model, row]));
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const quotas = {};
  for (const [model, ceiling] of Object.entries(caps)) {
    quotas[model] = { used: rows.get(model)?.total_tokens || 0, total: ceiling, resetAt, unit: "tokens",
      apiRequests: rows.get(model)?.api_requests || 0 };
  }
  for (const [model, row] of rows) {
    if (model in caps || !Number.isSafeInteger(row.total_tokens) || !Number.isSafeInteger(row.api_requests)) continue;
    quotas[model] = { used: row.total_tokens, total: null, limitUnknown: true, unit: "tokens", apiRequests: row.api_requests };
  }
  const format = new Intl.NumberFormat("en-US");
  return {
    plan: "NaN",
    quotas,
    summary: `${report.start_date}–${report.end_date}: ${format.format(total.total_tokens)} tokens, ${format.format(total.api_requests)} recorded requests. All time: ${format.format(all.total_tokens)} tokens.`,
  };
}

export async function getNanUsage(apiKey, proxyOptions) {
  if (!apiKey) return { plan: "NaN", message: "NaN API key missing" };
  const now = new Date();
  const url = new URL(U("nan").url);
  url.searchParams.set("start_date", `${now.toISOString().slice(0, 7)}-01`);
  url.searchParams.set("end_date", now.toISOString().slice(0, 10));
  const response = await proxyAwareFetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
  if (!response.ok) return { plan: "NaN", message: `NaN usage: HTTP ${response.status}` };
  return formatNanUsage(await response.json(), now);
}
