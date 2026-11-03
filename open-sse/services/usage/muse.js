/**
 * Muse (Meta) usage — Meta exposes no quota or balance endpoint for Muse Code
 * subscriptions (probed /v1/usage, /v1/me, /muse-code/* → 404), so this
 * summarises 9Router's own request log for the connection instead.
 * ponytail: local counts only; replace with Meta's API if one ships.
 */

const WINDOWS = [
  ["Last 5h", 5 * 3600e3],
  ["Last 24h", 24 * 3600e3],
  ["Last 7d", 7 * 24 * 3600e3],
];

/** @param {{timestamp:string,status:string,tokens:object}[]} rows */
export function summarizeLocalUsage(rows, now = Date.now()) {
  const quotas = {};
  for (const [label, ms] of WINDOWS) {
    const since = now - ms;
    let requests = 0, tokens = 0, errors = 0;
    for (const r of rows) {
      if (Date.parse(r.timestamp) < since) continue;
      requests++;
      if (r.status && r.status !== "ok") errors++;
      tokens += Number(r.tokens?.total_tokens) || 0;
    }
    quotas[`${label} requests`] = { used: requests, total: 0, resetAt: null, unlimited: true };
    quotas[`${label} tokens`] = { used: tokens, total: 0, resetAt: null, unlimited: true };
    if (errors) quotas[`${label} errors`] = { used: errors, total: 0, resetAt: null, unlimited: true };
  }
  return quotas;
}

export async function getMuseUsage(connectionId, providerSpecificData = null) {
  try {
    const { getUsageHistory } = await import("@/lib/usageDb.js");
    const since = new Date(Date.now() - WINDOWS.at(-1)[1]).toISOString();
    const rows = (await getUsageHistory({ provider: "muse", startDate: since }))
      .filter((r) => !connectionId || r.connectionId === connectionId);
    return {
      // No `message`: the dashboard hides the quota table when one is set.
      plan: `${providerSpecificData?.subscriptionTier || "Muse"} (local log)`,
      quotas: summarizeLocalUsage(rows),
    };
  } catch (error) {
    return { message: `Muse usage error: ${error.message}` };
  }
}
