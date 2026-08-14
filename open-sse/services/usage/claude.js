/**
 * Claude usage handler
 */

import { createHash } from "node:crypto";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";

// Claude API config (urls from registry, apiVersion is header logic kept here)
const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  apiVersion: ANTHROPIC_API_VERSION,
};

const SUCCESS_TTL_MS = 65_000;
const RETRY_MIN_MS = 3 * 60_000;
const RETRY_MAX_MS = 30 * 60_000;
const CACHE_MAX = 128;
const usageCache = new Map();
const inFlight = new Map();

function credentialKey(accessToken) {
  return createHash("sha256").update(String(accessToken ?? "")).digest("hex");
}

function setCache(key, entry) {
  usageCache.delete(key);
  usageCache.set(key, entry);
  while (usageCache.size > CACHE_MAX) usageCache.delete(usageCache.keys().next().value);
}

function createQuota(used, resetsAt) {
  const normalizedUsed = Math.min(100, Math.max(0, used));
  const remaining = 100 - normalizedUsed;
  return {
    used: normalizedUsed,
    total: 100,
    remaining,
    remainingPercentage: remaining,
    resetAt: parseResetTime(resetsAt),
    unlimited: false,
  };
}

function addQuota(quotas, name, used, resetsAt) {
  if (typeof used !== "number" || !Number.isFinite(used)) return;
  if (Object.keys(quotas).some((key) => key.toLowerCase() === name.toLowerCase())) return;
  quotas[name] = createQuota(used, resetsAt);
}

function normalizeClaudeUsage(data) {
  const quotas = {};

  addQuota(quotas, "session (5h)", data?.five_hour?.utilization, data?.five_hour?.resets_at);
  addQuota(quotas, "weekly (7d)", data?.seven_day?.utilization, data?.seven_day?.resets_at);

  for (const [key, value] of Object.entries(data || {})) {
    if (key.startsWith("seven_day_") && value && typeof value === "object") {
      addQuota(
        quotas,
        `weekly ${key.slice("seven_day_".length)} (7d)`,
        value.utilization,
        value.resets_at,
      );
    }
  }

  const limits = [
    ...(Array.isArray(data?.limits) ? data.limits : []),
    ...(Array.isArray(data?.rate_limits) ? data.rate_limits : []),
  ];
  for (const limit of limits) {
    const group = String(limit?.group || "").toLowerCase();
    const kind = String(limit?.kind || "").toLowerCase();
    if (kind === "session" || group === "session") {
      addQuota(quotas, "session (5h)", limit.percent, limit.resets_at);
      continue;
    }
    if (kind === "weekly_scoped" || group === "weekly") {
      const scopeName = limit?.scope?.model?.display_name || limit?.scope?.surface?.display_name;
      addQuota(
        quotas,
        scopeName ? `weekly ${scopeName} (7d)` : "weekly (7d)",
        limit.percent,
        limit.resets_at,
      );
    }
  }

  return {
    plan: "Claude Code",
    extraUsage: data?.extra_usage ?? null,
    quotas,
  };
}

function parseRetryAfterMs(value, now) {
  const text = String(value || "").trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const resetAt = Date.parse(text);
  return Number.isFinite(resetAt) ? Math.max(0, resetAt - now) : null;
}

function parseResetHeaderMs(value, now) {
  const text = String(value || "").trim();
  if (!text) return null;
  const numeric = Number(text);
  const resetAt = Number.isFinite(numeric)
    ? (numeric < 1e12 ? numeric * 1000 : numeric)
    : Date.parse(text);
  return Number.isFinite(resetAt) && resetAt > now && resetAt <= 8.64e15
    ? resetAt - now
    : null;
}

function retryAfterMs(response, now) {
  let parsed = parseRetryAfterMs(response.headers.get("retry-after"), now);
  if (parsed === null) {
    response.headers.forEach((value, name) => {
      if (!/^anthropic-ratelimit-.+-reset$/i.test(name)) return;
      const candidate = parseResetHeaderMs(value, now);
      if (candidate !== null && (parsed === null || candidate > parsed)) parsed = candidate;
    });
  }
  return Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, parsed ?? RETRY_MIN_MS));
}

async function fetchClaudeUsage(accessToken, proxyOptions, key) {
  try {
    // Primary: OAuth usage endpoint (Claude Code consumer OAuth tokens)
    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
      signal: AbortSignal.timeout(5_000),
    }, proxyOptions);

    if (oauthResponse.ok) {
      const value = normalizeClaudeUsage(await oauthResponse.json());
      setCache(key, { value, expiresAt: Date.now() + SUCCESS_TTL_MS, retryAt: 0 });
      return value;
    }

    if (oauthResponse.status === 429) {
      const now = Date.now();
      const cached = usageCache.get(key);
      const value = cached?.value || { message: "Claude usage is rate limited. Retry later." };
      setCache(key, {
        value,
        expiresAt: cached?.expiresAt || 0,
        retryAt: now + retryAfterMs(oauthResponse, now),
      });
      return value;
    }

    if (oauthResponse.status === 401) {
      return { message: "Claude authentication expired (401). Re-authorize or refresh the connection." };
    }

    if (oauthResponse.status === 404 || oauthResponse.status === 405) {
      const legacy = await getClaudeUsageLegacy(accessToken, proxyOptions);
      if (legacy.cacheable) {
        setCache(key, { value: legacy.value, expiresAt: Date.now() + SUCCESS_TTL_MS, retryAt: 0 });
      }
      return legacy.value;
    }

    return { message: `Claude connected. Usage endpoint returned HTTP ${oauthResponse.status}.` };
  } catch {
    return { message: "Claude connected. Unable to fetch usage." };
  }
}

export function getClaudeUsage(accessToken, proxyOptions = null, options = {}) {
  const key = credentialKey(accessToken);
  const cached = usageCache.get(key);
  const now = Date.now();
  const force = options?.force === true;
  // Manual refresh may bypass a successful-value TTL, but never the server's
  // retry window after 429. In-flight requests are always deduplicated.
  if (cached && (now < cached.retryAt || (!force && now < cached.expiresAt))) {
    return Promise.resolve(cached.value);
  }
  if (inFlight.has(key)) return inFlight.get(key);
  if (inFlight.size >= CACHE_MAX) {
    // ponytail: 128 active polls match current profile ceiling; add a bounded
    // wait queue before increasing this ceiling.
    return Promise.resolve({ message: "Claude usage refresh is busy. Retry shortly." });
  }

  let request;
  request = fetchClaudeUsage(accessToken, proxyOptions, key).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

/**
 * Legacy Claude usage for API key / org admin users
 */
async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            cacheable: true,
            value: {
              plan: settings.plan || "Unknown",
              organization: settings.organization_name,
              quotas: usage,
            },
          };
        }

        return {
          cacheable: false,
          value: {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            message: "Claude connected. Usage details require admin access.",
          },
        };
      }

      return {
        cacheable: true,
        value: {
          plan: settings.plan || "Unknown",
          organization: settings.organization_name,
          message: "Claude connected. Usage details require admin access.",
        },
      };
    }

    return {
      cacheable: false,
      value: { message: "Claude connected. Usage API requires admin permissions." },
    };
  } catch {
    return {
      cacheable: false,
      value: { message: "Claude connected. Unable to fetch usage." },
    };
  }
}
