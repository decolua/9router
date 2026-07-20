/**
 * Grok CLI / Grok Build usage handler
 *
 * Source of truth: official grok-shell/grok-pager traffic to cli-chat-proxy.grok.com
 *   GET /v1/billing?format=credits   — weekly credit window (percent-based for SuperGrok)
 *   GET /v1/billing                 — monthly absolute limit/used (when present)
 *   GET /v1/user?include=subscription
 *
 * Unified billing accounts (isUnifiedBillingUser / SuperGrok / X Premium+) return:
 * {
 *   config: {
 *     creditUsagePercent: 55,                 // overall weekly credit burn %
 *     productUsage: [                         // per-product split
 *       { product: "GrokBuild", usagePercent: 45 },
 *       { product: "GrokChat", usagePercent: 10 }
 *     ],
 *     onDemandCap: { val: 0 },                // often 0 even with remaining credits
 *     onDemandUsed: { val: 0 },
 *     prepaidBalance: { val: 0 },
 *     isUnifiedBillingUser: true,
 *     billingPeriodStart, billingPeriodEnd
 *   }
 * }
 *
 * Older / promo accounts may still surface absolute onDemandCap/Used or prepaidBalance.
 * Plain /v1/billing adds monthlyLimit + used for absolute monthly bars.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../../config/grokCli.js";

const USAGE = U("grok-cli");
const BILLING_URL = USAGE.url || "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USER_URL = USAGE.userUrl || "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
// Absolute monthly window lives on the unformatted billing endpoint.
const PLAIN_BILLING_URL =
  (typeof BILLING_URL === "string" && BILLING_URL.includes("?"))
    ? BILLING_URL.replace(/\?.*$/, "")
    : "https://cli-chat-proxy.grok.com/v1/billing";

/** Unwrap protobuf-json `{ val: n }` or plain numbers/strings. */
function unwrapVal(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
    return toFiniteNumber(value.val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

/** "GrokBuild" → "Grok Build", "XPremiumPlus" → "X Premium Plus", "super_grok" → "Super Grok" */
function humanizeIdentifier(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const spaced = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildGrokCliHeaders(accessToken, providerSpecificData = {}) {
  const psd = providerSpecificData || {};
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-mode": "headless",
  };
  const email = psd.email;
  const userId = psd.userId || psd.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

function subscriptionTier(user, config) {
  const rawTier =
    user?.subscriptionTier ??
    user?.subscription_tier ??
    user?.subscription?.tier ??
    config?.subscriptionTier ??
    config?.subscription_tier;
  return typeof rawTier === "string" ? rawTier.trim() : "";
}

function resolvePlan(user, config) {
  const tier = subscriptionTier(user, config);
  if (tier) return humanizeIdentifier(tier) || tier;
  if (user?.hasGrokCodeAccess === true) return "Grok Code";
  if (config?.isUnifiedBillingUser === true) return "Grok Build";
  return "Grok Build";
}

function makeQuota({ used, total, resetAt, unlimited = false }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  // Do NOT set absolute `remaining` — QuotaTable's getRemainingPercentage treats
  // `remaining` as a 0–100 percentage (same trap as Qoder credits).
  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

/** Percent-used (0–100) → quota row with total 100 so the bar/label match. */
function makePercentQuota(usagePercent, resetAt) {
  const used = Math.min(100, Math.max(0, toFiniteNumber(usagePercent, 0)));
  return {
    used,
    total: 100,
    remainingPercentage: Math.max(0, 100 - used),
    resetAt: resetAt || null,
    unlimited: false,
  };
}

function extractConfig(billing) {
  const root = billing && typeof billing === "object" ? billing : {};
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : root;
  return { root, config };
}

/**
 * Map billing JSON → normalized quotas object for the dashboard.
 * @param {object|null} billing - /v1/billing?format=credits body
 * @param {object|null} user - /v1/user?include=subscription body
 * @param {object|null} plainBilling - optional /v1/billing (no format) body
 */
export function parseGrokCliBilling(billing, user = null, plainBilling = null) {
  const { root, config } = extractConfig(billing);

  const periodEnd =
    parseResetTime(config.billingPeriodEnd) ||
    parseResetTime(config.billing_period_end) ||
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(config.resetAt || config.resetsAt || config.periodEnd) ||
    parseResetTime(root.billingPeriodEnd) ||
    parseResetTime(root.billing_period_end) ||
    parseResetTime(root.resetAt || root.resetsAt || root.periodEnd) ||
    null;

  const quotas = {};
  const tier = subscriptionTier(user, config);
  const subscriptionAccess = Boolean(tier) && !/^(free|none|null)$/i.test(tier);

  // Current Grok Build responses expose included monthly usage at top level.
  const monthlyLimit = unwrapVal(
    config.monthlyLimit ?? config.monthly_limit ?? root.monthlyLimit ?? root.monthly_limit,
    NaN,
  );
  const includedUsed = unwrapVal(
    config.includedUsed ?? config.included_used ?? root.includedUsed ?? root.included_used,
    NaN,
  );
  const totalUsed = unwrapVal(
    config.totalUsed ?? config.total_used ?? root.totalUsed ?? root.total_used,
    NaN,
  );
  if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
    quotas["Monthly included"] = makeQuota({
      used: Number.isFinite(includedUsed)
        ? includedUsed
        : Number.isFinite(totalUsed)
          ? totalUsed
          : 0,
      total: monthlyLimit,
      resetAt: periodEnd,
    });
  }

  // ── 1. Unified / SuperGrok: percent-based weekly credits ─────────────────
  // Live SuperGrok accounts return creditUsagePercent + productUsage while
  // onDemandCap stays 0 — that must NOT be treated as exhausted.
  const productUsage = Array.isArray(config.productUsage)
    ? config.productUsage
    : Array.isArray(root.productUsage)
      ? root.productUsage
      : [];

  let hasPercentQuota = false;

  if (productUsage.length > 0) {
    for (const item of productUsage) {
      if (!item || typeof item !== "object") continue;
      const pct = unwrapVal(item.usagePercent, NaN);
      if (!Number.isFinite(pct)) continue;
      const name = humanizeIdentifier(item.product) || "Usage";
      // Avoid clobbering if the same product appears twice
      if (quotas[name]) continue;
      quotas[name] = makePercentQuota(pct, periodEnd);
      hasPercentQuota = true;
    }
  }

  const creditUsagePercent = unwrapVal(
    config.creditUsagePercent ?? root.creditUsagePercent,
    NaN,
  );
  // Overall credits bar when no per-product rows (or as single summary when only overall exists)
  if (!hasPercentQuota && Number.isFinite(creditUsagePercent)) {
    quotas.Credits = makePercentQuota(creditUsagePercent, periodEnd);
    hasPercentQuota = true;
  }

  // ── 2. Absolute on-demand window (promo / older account types) ───────────
  const onDemandCap = unwrapVal(config.onDemandCap ?? root.onDemandCap, NaN);
  const onDemandUsed = unwrapVal(config.onDemandUsed ?? root.onDemandUsed, NaN);
  if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
    const used = Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0;
    quotas["On-demand"] = makeQuota({
      used,
      total: onDemandCap,
      resetAt: periodEnd,
    });
  } else if (
    // Unified percent-based or paid accounts keep onDemandCap=0 while access remains active.
    !hasPercentQuota &&
    !subscriptionAccess &&
    Number.isFinite(onDemandCap) &&
    onDemandCap === 0 &&
    Number.isFinite(onDemandUsed)
  ) {
    // Cap 0 is the exhausted free/promo state (chat returns 402 spending-limit).
    // UI treats total===0 as unlimited, so use a synthetic 1/1 depleted row.
    quotas["On-demand"] = {
      used: 1,
      total: 1,
      remainingPercentage: 0,
      resetAt: periodEnd,
      unlimited: false,
    };
  }

  // ── 3. Prepaid top-up balance (remaining pot; no allotment known) ────────
  const prepaid = unwrapVal(config.prepaidBalance ?? root.prepaidBalance, NaN);
  if (Number.isFinite(prepaid) && prepaid > 0) {
    quotas.Prepaid = {
      used: 0,
      total: prepaid,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
    };
  }

  // ── 4. Opportunistic richer credit envelopes ─────────────────────────────
  const creditBags = [
    root.credits,
    root.creditBalance,
    root.usage,
    config.credits,
    config.includedCredits,
    config.subscriptionCredits,
  ].filter((bag) => bag && typeof bag === "object" && !Array.isArray(bag));

  for (const bag of creditBags) {
    const total = unwrapVal(
      bag.total ?? bag.limit ?? bag.cap ?? bag.allocation ?? bag.amount,
      NaN,
    );
    const used = unwrapVal(bag.used ?? bag.spent ?? bag.consumed, NaN);
    const remaining = unwrapVal(bag.remaining ?? bag.balance ?? bag.left, NaN);
    if (Number.isFinite(total) && total > 0) {
      const resolvedUsed = Number.isFinite(used)
        ? used
        : Number.isFinite(remaining)
          ? Math.max(0, total - remaining)
          : 0;
      if (!quotas.Credits) {
        quotas.Credits = makeQuota({
          used: resolvedUsed,
          total,
          resetAt: parseResetTime(bag.resetAt || bag.resetsAt || bag.end) || periodEnd,
        });
      }
    } else if (Number.isFinite(remaining) && remaining >= 0 && !quotas.Credits) {
      quotas.Credits = {
        used: 0,
        total: remaining > 0 ? remaining : 1,
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }
  }

  // ── 5. Plain /v1/billing monthly absolute window ─────────────────────────
  if (plainBilling && typeof plainBilling === "object") {
    const { config: plainConfig } = extractConfig(plainBilling);
    const monthlyLimit = unwrapVal(plainConfig.monthlyLimit, NaN);
    const monthlyUsed = unwrapVal(plainConfig.used, NaN);
    const monthlyReset = parseResetTime(plainConfig.billingPeriodEnd) || null;

    if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
      quotas.Monthly = makeQuota({
        used: Number.isFinite(monthlyUsed) ? Math.max(0, monthlyUsed) : 0,
        total: monthlyLimit,
        resetAt: monthlyReset,
      });
    }
  }

  // Exhausted when every finite quota bar is at 0% remaining
  const exhausted =
    Object.keys(quotas).length > 0 &&
    Object.values(quotas).every(
      (q) => q.unlimited !== true && (q.remainingPercentage ?? 100) <= 0,
    );

  return {
    plan: resolvePlan(user, config),
    quotas,
    periodEnd,
    exhausted,
    subscriptionAccess,
    rawConfig: config,
  };
}

/**
 * @param {string} accessToken
 * @param {object|null} providerSpecificData
 * @param {object|null} proxyOptions
 */
export async function getGrokCliUsage(accessToken, providerSpecificData = null, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Grok CLI access token not available." };
  }

  const headers = buildGrokCliHeaders(accessToken, providerSpecificData);

  try {
    // Credits (weekly %) + plain monthly + user profile — same startup pattern as CLI
    const [billingRes, plainRes, userRes] = await Promise.all([
      proxyAwareFetch(
        BILLING_URL,
        { method: "GET", headers },
        proxyOptions,
      ),
      proxyAwareFetch(
        PLAIN_BILLING_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
      proxyAwareFetch(
        USER_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
    ]);

    if (billingRes.status === 401 || billingRes.status === 403) {
      return { message: "Grok CLI authentication expired. Please re-authorize." };
    }

    if (!billingRes.ok) {
      const errText = await billingRes.text().catch(() => "");
      const trimmed = errText ? `: ${errText.slice(0, 200)}` : "";
      return { message: `Grok CLI billing API error (${billingRes.status})${trimmed}` };
    }

    const billing = await billingRes.json().catch(() => null);
    if (!billing || typeof billing !== "object") {
      return { message: "Grok CLI billing response was not JSON." };
    }

    let plainBilling = null;
    if (plainRes?.ok) {
      plainBilling = await plainRes.json().catch(() => null);
    }

    let user = null;
    if (userRes?.ok) {
      user = await userRes.json().catch(() => null);
    }

    const parsed = parseGrokCliBilling(billing, user, plainBilling);

    if (!parsed.quotas || Object.keys(parsed.quotas).length === 0) {
      return {
        plan: parsed.plan,
        message: parsed.subscriptionAccess
          ? "Subscription access is active; Grok does not expose a numeric included quota."
          : "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted.",
        quotas: {},
      };
    }

    // Dashboard hides QuotaTable whenever `message` is set, so only attach a
    // message when there are no quota rows to render. Depleted accounts keep
    // their 0% bars without a blocking message.
    return {
      plan: parsed.plan,
      quotas: parsed.quotas,
    };
  } catch (error) {
    return { message: `Grok CLI usage error: ${error.message}` };
  }
}
