/**
 * Usage figures for a connection whose quota cannot be read from upstream.
 *
 * This is a fallback, not the normal path. Claude Code CLI holds an ordinary
 * Claude subscription and its real 5h/7d windows are readable — see
 * claudeCliUsage.js, which is what the card shows when a credential can be
 * resolved. What lands here is an account that has none to ask with: a
 * config-directory account whose token has expired, or one whose login never
 * completed.
 *
 * With no upstream window there is nothing to show a percentage of. What this
 * server does know is what it routed itself, already recorded per connection
 * in usageHistory. That is what these figures are — every quota returned here
 * is flagged `unlimited: true`, so no progress bar is drawn against a limit
 * that was never reported, and named to say where the number came from rather
 * than being dressed up as a subscription quota.
 */
import { getAdapter } from "@/lib/db/driver.js";

const WINDOWS = [
  { label: "routed 5h", hours: 5 },
  { label: "routed 24h", hours: 24 },
  { label: "routed 7d", hours: 24 * 7 },
];

function sinceIso(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function sumTokens(rows) {
  let tokens = 0;
  for (const row of rows) {
    try {
      const parsed = typeof row.tokens === "string" ? JSON.parse(row.tokens) : (row.tokens || {});
      tokens += Number(parsed?.total)
        || (Number(parsed?.prompt_tokens) || 0) + (Number(parsed?.completion_tokens) || 0);
    } catch { /* a malformed row should not lose the rest of the window */ }
  }
  return tokens;
}

/**
 * @param {{ id: string, provider: string }} connection
 * @returns {Promise<{ quotas: object, message?: string, source: string }>}
 */
export async function getRoutedUsage(connection) {
  const db = await getAdapter();
  const quotas = {};

  for (const { label, hours } of WINDOWS) {
    const rows = db.all(
      "SELECT cost, tokens, status FROM usageHistory WHERE connectionId = ? AND timestamp >= ?",
      [connection.id, sinceIso(hours)],
    );
    const failed = rows.filter((r) => r.status && r.status !== "success" && r.status !== "ok").length;
    const cost = rows.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

    quotas[`${label} · requests`] = {
      used: rows.length,
      // No upstream limit was reported, so there is no remaining to draw.
      unlimited: true,
      remaining: null,
      remainingPercentage: null,
      resetAt: null,
      // The table prints "<n> used" itself, so this only adds what that
      // line cannot say. Nothing to add when every request succeeded.
      detail: failed ? `${failed} failed` : undefined,
    };
    quotas[`${label} · tokens`] = {
      used: sumTokens(rows),
      unlimited: true,
      remaining: null,
      remainingPercentage: null,
      resetAt: null,
      detail: cost > 0 ? `≈ $${cost.toFixed(4)} at list price` : undefined,
    };
  }

  return {
    quotas,
    source: "9router",
    // Shown in the card so nobody reads these as subscription limits.
    message: "Counted by 9Router from what it routed — this provider reports no "
      + "quota, so remaining and reset are unknown.",
  };
}

export default getRoutedUsage;
