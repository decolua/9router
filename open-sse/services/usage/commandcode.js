/**
 * Command Code usage — undocumented endpoints the official CLI uses for its
 * /usage overlay (extracted from dist/cli.mjs v1.39.3):
 * GET /alpha/billing/credits + /alpha/usage/summary + /alpha/billing/subscriptions
 * Auth: Bearer <apiKey> (key starts with user_...)
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

const COMMANDCODE_BASE = "https://api.commandcode.ai";
const COMMANDCODE_HEADERS = {
  "User-Agent": "cli",
  "x-cli-environment": "production",
  "x-command-code-version": "1.39.3",
};

async function commandCodeGet(path, apiKey, proxyOptions) {
  const response = await proxyAwareFetch(`${COMMANDCODE_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...COMMANDCODE_HEADERS,
    },
  }, proxyOptions);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json().catch(() => null);
}

function commandCodeWindow(name, w) {
  if (!w || typeof w !== "object") return null;
  const total = toFiniteNumber(w.cap, 0);
  if (total <= 0) return null;
  return {
    // resetAt 0 = window idle → null hides the countdown instead of lying.
    used: toFiniteNumber(w.used, 0),
    total,
    resetAt: w.resetAt ? parseResetTime(w.resetAt) : null,
  };
}

export async function getCommandCodeUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Command Code API key not available." };
  }

  try {
    const credits = await commandCodeGet("/alpha/billing/credits", apiKey.trim(), proxyOptions);
    // Best-effort extras: without summary there is no Monthly cap to show.
    const [summary, subscription] = await Promise.all([
      commandCodeGet("/alpha/usage/summary", apiKey.trim(), proxyOptions).catch(() => null),
      commandCodeGet("/alpha/billing/subscriptions", apiKey.trim(), proxyOptions).catch(() => null),
    ]);

    const quotas = {};
    const windows = credits?.windowLimits || {};
    const fiveHour = commandCodeWindow("5-hour", windows.fiveHour);
    const weekly = commandCodeWindow("Weekly", windows.weekly);
    if (fiveHour) quotas["5-hour"] = fiveHour;
    if (weekly) quotas["Weekly"] = weekly;

    // monthlyCredits is REMAINING, not a cap. No cap is exposed upstream, so
    // the Monthly row is reconstructed as remaining + spent-in-period.
    const monthlyRemaining = toFiniteNumber(credits?.credits?.monthlyCredits, -1);
    const spent = toFiniteNumber(summary?.totalCost, 0);
    if (monthlyRemaining >= 0 && spent > 0) {
      quotas["Monthly"] = {
        used: spent,
        total: monthlyRemaining + spent,
        resetAt: parseResetTime(subscription?.data?.currentPeriodEnd) || null,
      };
    }

    if (Object.keys(quotas).length === 0) {
      return { plan: "Command Code", message: "Command Code connected. No quota data reported." };
    }

    return { plan: "Command Code", quotas };
  } catch (error) {
    if (error.message === "HTTP 401") {
      return { message: "Command Code API key invalid or expired." };
    }
    return { message: `Command Code connected. Unable to fetch usage: ${error.message}` };
  }
}
