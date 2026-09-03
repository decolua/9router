/**
 * OpenCode Go usage handler
 *
 * Source of truth: GET https://opencode.ai/zen/go/v1/usage, authenticated with the
 * same sk-... key used for chat. Measured live on 2026-08-12 against a key whose
 * monthly window was depleted:
 *
 * {
 *   "usage": {
 *     "rolling": { "status": "ok",           "percent": 0,   "resetsAt": "2026-08-12T09:43:25.596Z" },
 *     "weekly":  { "status": "ok",           "percent": 0,   "resetsAt": "2026-08-17T00:00:00.596Z" },
 *     "monthly": { "status": "rate-limited", "percent": 100, "resetsAt": "2026-08-12T19:57:51.596Z" }
 *   }
 * }
 *
 * Four properties drive the parsing below, all measured rather than assumed:
 *
 * 1. `percent` is percent USED. The depleted window reads 100, not 0.
 * 2. `status` is "ok" or "rate-limited". A window counts as blocked on EITHER
 *    signal (status, or percent at 100), so an upstream that renames the status
 *    string still reports the window as blocked instead of silently healthy.
 * 3. On an untouched window `resetsAt` is a PROJECTION, not a deadline: two samples
 *    34 minutes apart showed `rolling` move while `monthly` stayed put. Only a
 *    window that is blocked or partly used gets its reset surfaced, so the table
 *    does not show an idle window as having a pending deadline.
 * 4. `monthly` is a rolling ~30 day window, not a calendar month: the depleted key
 *    reported a reset 10 hours out, not the first of the next month.
 *
 * The endpoint exists only on the Go tier. The keyless `opencode` provider is a
 * different base URL and answers this path with a 404 HTML page.
 */

import { U, parseResetTime, toFiniteNumber, fetchWithTimeout } from "./shared.js";

const USAGE = U("opencode-go");
export const OPENCODE_GO_USAGE_URL = USAGE.url || "https://opencode.ai/zen/go/v1/usage";

// Display order for the windows the upstream is known to report. Anything else it
// starts sending is appended after these, sorted, so a new window shows up in the
// table the day it appears instead of waiting for a code change.
const KNOWN_WINDOWS = [
  ["rolling", "Rolling"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
];

function labelFor(key) {
  const known = KNOWN_WINDOWS.find(([k]) => k === key);
  if (known) return known[1];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Blocked on EITHER signal (property 2 above). `status` is compared case
 * insensitively with `_` folded to `-`, so "rate_limited" reads the same as
 * "rate-limited".
 */
function isBlocked(status, percentUsed) {
  const byStatus =
    typeof status === "string" &&
    status.trim().toLowerCase().replace(/_/g, "-") === "rate-limited";
  const byPercent = Number.isFinite(percentUsed) && percentUsed >= 100;
  return byStatus || byPercent;
}

/**
 * Turn the raw payload into the quota map the dashboard renders.
 *
 * Exported for tests. `used`/`total` are a 0-100 pair because QuotaTable reads
 * `remaining` as a percentage, never an absolute count (same trap documented on
 * the Qoder and Grok handlers). `remainingPercentage` is set for the same reason.
 *
 * @param {object} payload - Parsed JSON body of GET /zen/go/v1/usage
 * @returns {{ quotas: object, limitReached: boolean }|null} null when unparsable
 */
export function parseOpenCodeGoUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const known = KNOWN_WINDOWS.map(([key]) => key).filter((key) => key in usage);
  const extra = Object.keys(usage)
    .filter((key) => !KNOWN_WINDOWS.some(([k]) => k === key))
    .sort();

  const quotas = {};
  let limitReached = false;

  for (const key of [...known, ...extra]) {
    const window = usage[key];
    // One malformed window must not blind the table to the others.
    if (!window || typeof window !== "object" || Array.isArray(window)) continue;

    const rawPercent = toFiniteNumber(window.percent, NaN);
    const hasPercent = Number.isFinite(rawPercent);
    const blocked = isBlocked(window.status, hasPercent ? rawPercent : NaN);
    if (blocked) limitReached = true;

    const used = hasPercent ? Math.max(0, Math.min(100, Math.round(rawPercent))) : blocked ? 100 : 0;
    // Property 3: an untouched window's resetsAt is "now plus the window length",
    // which is not a fact about anything.
    const showReset = blocked || used > 0;

    quotas[labelFor(key)] = {
      used,
      total: 100,
      remainingPercentage: 100 - used,
      resetAt: showReset ? parseResetTime(window.resetsAt) : null,
      unlimited: false,
    };
  }

  if (Object.keys(quotas).length === 0) return null;
  return { quotas, limitReached };
}

/**
 * True when a 4xx body says the plan window is spent rather than the key being
 * bad. Exhausted: {"error":{"type":"CreditsError","message":"Insufficient balance..."}}
 * Revoked:   {"error":{"type":"AuthError","message":"Invalid API key."}}
 *
 * Match on the STRUCTURE, never a substring of the message: that message embeds a
 * workspace-scoped billing URL, so reading it would make an account identifier
 * load-bearing, and a substring like "balance" would misfire on an unrelated body.
 *
 * @param {string} bodyText
 * @returns {boolean}
 */
export function isOpenCodeGoCreditsError(bodyText) {
  try {
    return JSON.parse(bodyText)?.error?.type === "CreditsError";
  } catch {
    return false;
  }
}

/**
 * @param {string} apiKey
 * @param {object|null} proxyOptions
 */
export async function getOpenCodeGoUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "OpenCode Go API key not available." };
  }

  try {
    const response = await fetchWithTimeout(
      OPENCODE_GO_USAGE_URL,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
      10000,
      proxyOptions,
    );

    // A key with every window spent still answers 200 here (it is the chat call
    // that 401s), so a 401 on this endpoint really does mean a bad key.
    if (response.status === 401 || response.status === 403) {
      return { message: "OpenCode Go API key invalid or expired." };
    }
    if (!response.ok) {
      return { message: `OpenCode Go usage API error (${response.status}).` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { message: "OpenCode Go usage response was not JSON." };
    }

    const parsed = parseOpenCodeGoUsage(data);
    if (!parsed) {
      return { plan: "OpenCode Go", message: "OpenCode Go reported no usage windows.", quotas: {} };
    }

    return {
      plan: "OpenCode Go",
      limitReached: parsed.limitReached,
      quotas: parsed.quotas,
    };
  } catch (error) {
    return { message: `OpenCode Go usage fetch failed: ${error.message}` };
  }
}
