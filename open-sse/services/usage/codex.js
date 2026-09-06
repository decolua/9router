/**
 * Codex (OpenAI) usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: U("codex").url,
  resetCreditsUrl: U("codex").resetCreditsUrl,
  resetCreditsConsumeUrl: U("codex").resetCreditsConsumeUrl,
};

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

function errorMessage(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value.message === "string") return value.message;
  return JSON.stringify(value);
}

function normalizeSubscriptionIso(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? value.toISOString() : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isFinite(num)) return null;
      const ms = num < 1e12 ? num * 1000 : num;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(pad);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function normalizeSubscriptionId(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/[\r\n]+/g, "").trim();
  return normalized || null;
}

function getCodexSubscriptionHints(payload) {
  if (!payload || typeof payload !== "object") return { organizationId: null, accountId: null };
  const nested = payload["https://api.openai.com/auth"];
  const auth = nested && typeof nested === "object" ? nested : {};
  return {
    organizationId: normalizeSubscriptionId(
      auth.organization_id || auth.poid || auth.org_id || auth.chatgpt_organization_id ||
      payload.organization_id || payload.poid || payload.org_id || payload.chatgpt_organization_id,
    ),
    accountId: normalizeSubscriptionId(
      auth.chatgpt_account_id || payload.chatgpt_account_id || payload.account_id,
    ),
  };
}

function buildCodexSubscriptionHeaders(accessToken, targetUrl, accountId = null) {
  const targetPath = new URL(targetUrl).pathname;
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Accept": "application/json",
    "Referer": "https://chatgpt.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "x-openai-target-path": targetPath,
    "x-openai-target-route": targetPath,
  };
  const normalizedAccountId = normalizeSubscriptionId(accountId);
  if (normalizedAccountId) headers["ChatGPT-Account-Id"] = normalizedAccountId;
  return headers;
}

function collectCodexSubscriptionAccounts(data) {
  if (!data || typeof data !== "object") return [];
  const ordering = data.account_ordering || data.accountOrdering ||
    data.data?.account_ordering || data.data?.accountOrdering ||
    data.result?.account_ordering || data.result?.accountOrdering || [];
  const source = Array.isArray(data)
    ? data
    : data.accounts ?? data.data?.accounts ?? data.result?.accounts ??
      (Array.isArray(data.data) ? data.data : []);
  const entries = Array.isArray(source)
    ? source.map((value, index) => [null, value, index])
    : source && typeof source === "object"
      ? Object.entries(source).map(([key, value], index) => [key, value, index])
      : [];

  const records = entries.map(([mapKey, value, index]) => {
    const wrapper = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const account = wrapper.account && typeof wrapper.account === "object" && !Array.isArray(wrapper.account)
      ? wrapper.account
      : wrapper;
    return {
      ...wrapper,
      ...account,
      entitlement: wrapper.entitlement || account.entitlement || null,
      _accountMapKey: normalizeSubscriptionId(mapKey),
      _accountOrderIndex: index,
    };
  });

  if (!Array.isArray(ordering) || ordering.length === 0) return records;
  const orderIndex = new Map(ordering.map((value, index) => [String(value), index]));
  const orderedIndex = (record) => {
    const keys = [
      record._accountMapKey,
      record.organization_id,
      record.org_id,
      record.workspace_id,
      record.id,
      record.account_id,
      record.chatgpt_account_id,
      record.accountId,
    ].map(normalizeSubscriptionId).filter(Boolean);
    for (const key of keys) {
      if (orderIndex.has(key)) return orderIndex.get(key);
    }
    return Number.POSITIVE_INFINITY;
  };
  return records.sort((a, b) => orderedIndex(a) - orderedIndex(b) || a._accountOrderIndex - b._accountOrderIndex);
}

function getJwtSubscriptionClaimFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const nested = payload["https://api.openai.com/auth"];
  if (nested && typeof nested === "object" && nested.chatgpt_subscription_active_until != null) {
    return nested.chatgpt_subscription_active_until;
  }
  if (payload.chatgpt_subscription_active_until != null) return payload.chatgpt_subscription_active_until;
  return null;
}

function normalizeCodexPlan(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("chatgpt") && lower.endsWith("plan")) {
    const middle = lower.slice(7, -4).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    const tier = middle.replace(/[^a-z0-9]/g, "");
    if (tier) return tier.slice(0, 64);
  }
  return lower.slice(0, 64);
}

function getJwtPlanFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const nested = payload["https://api.openai.com/auth"];
  let plan = null;
  if (nested && typeof nested === "object") plan = nested.chatgpt_plan_type || nested.chatgpt_plan || null;
  if (!plan) plan = payload.chatgpt_plan_type || payload.plan_type || null;
  if (typeof plan === "string") {
    const t = plan.trim();
    return t || null;
  }
  return plan || null;
}

function getJwtSubscriptionClaim(idToken) {
  return getJwtSubscriptionClaimFromPayload(decodeJwtPayload(idToken));
}

function getJwtPlan(idToken) {
  return getJwtPlanFromPayload(decodeJwtPayload(idToken));
}

function getCodexAccountId(providerSpecificData) {
  return providerSpecificData?.workspaceId || providerSpecificData?.accountId || providerSpecificData?.chatgptAccountId || null;
}

function getCodexRateLimitBody(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot.rate_limit && typeof snapshot.rate_limit === "object"
    ? snapshot.rate_limit
    : snapshot;
}

function formatCodexWindow(window) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window?.used_percent ?? window?.percent_used, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt: parseResetTime(window?.reset_at ?? window?.resets_at ?? window?.resetAt ?? null),
    unlimited: false,
  };
}

function appendCodexQuotaWindows(quotas, prefix, snapshot) {
  const rateLimit = getCodexRateLimitBody(snapshot);
  if (!rateLimit) return false;

  const primary = rateLimit.primary_window || rateLimit.primary || snapshot.primary_window || snapshot.primary;
  const secondary = rateLimit.secondary_window || rateLimit.secondary || snapshot.secondary_window || snapshot.secondary;
  let added = false;

  if (primary) {
    quotas[prefix ? `${prefix}_session` : "session"] = formatCodexWindow(primary);
    added = true;
  }
  if (secondary) {
    quotas[prefix ? `${prefix}_weekly` : "weekly"] = formatCodexWindow(secondary);
    added = true;
  }

  return added;
}

function getCodexReviewRateLimit(data) {
  if (data.code_review_rate_limit || data.review_rate_limit) {
    return data.code_review_rate_limit || data.review_rate_limit;
  }

  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    return byLimitId.code_review || byLimitId.codex_review || byLimitId.review || null;
  }

  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return additional.find((entry) => {
    const id = String(entry?.limit_name || entry?.metered_feature || entry?.id || "").toLowerCase();
    return id === "code_review" || id === "codex_review" || id === "review" || id.includes("review");
  }) || null;
}

function getCodexSparkRateLimit(data) {
  if (data.spark_rate_limit || data.gpt_5_3_codex_spark_rate_limit) {
    return data.spark_rate_limit || data.gpt_5_3_codex_spark_rate_limit;
  }

  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    return byLimitId["gpt-5.3-codex-spark"] || byLimitId.gpt_5_3_codex_spark || byLimitId.spark || null;
  }

  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return additional.find((entry) => {
    const id = String(entry?.limit_name || entry?.metered_feature || entry?.id || "").toLowerCase();
    return id.includes("spark") || id.includes("5.3-codex-spark");
  }) || null;
}

export async function getCodexUsage(accessToken, proxyOptions = null) {
  try {
    const response = await proxyAwareFetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();
    const normalRateLimit = data.rate_limit || data.rate_limits || data.rate_limits_by_limit_id?.codex || {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const sparkRateLimit = getCodexSparkRateLimit(data);
    const availableResetCredits = Math.max(0, toFiniteNumber(data.rate_limit_reset_credits?.available_count, 0));
    const quotas = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);
    appendCodexQuotaWindows(quotas, "spark", sparkRateLimit);

    return {
      plan: data.plan_type || data.summary?.plan || "unknown",
      limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      sparkLimitReached: getCodexRateLimitBody(sparkRateLimit)?.limit_reached || false,
      resetCredits: { availableCount: availableResetCredits },
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}

export async function getCodexRateLimitResetCredits(accessToken, proxyOptions = null, providerSpecificData = null) {
  if (!accessToken) {
    throw new Error("No Codex access token available. Please re-authorize the connection.");
  }

  const accountId = getCodexAccountId(providerSpecificData);
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Accept": "application/json",
    "OpenAI-Beta": "codex-1",
    "originator": "codex_cli_rs",
  };
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;

  const response = await proxyAwareFetch(CODEX_CONFIG.resetCreditsUrl, {
    method: "GET",
    headers,
  }, proxyOptions);

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = errorMessage(data?.message || data?.error || data?.detail, `Codex reset credits API unavailable (${response.status}).`);
    throw new Error(message);
  }

  const credits = Array.isArray(data?.credits) ? data.credits : [];
  return {
    availableCount: Math.max(0, toFiniteNumber(data?.available_count ?? data?.availableCount, 0)),
    credits: credits.map((credit) => ({
      status: String(credit?.status || "unknown"),
      grantedAt: toIsoDate(credit?.granted_at ?? credit?.grantedAt),
      expiresAt: toIsoDate(credit?.expires_at ?? credit?.expiresAt),
    })),
  };
}

// Consume one Codex rate-limit reset credit (irreversible, spends 1 credit)
export async function consumeCodexRateLimitResetCredit(accessToken, redeemRequestId, proxyOptions = null) {
  if (!accessToken) {
    throw new Error("No Codex access token available. Please re-authorize the connection.");
  }
  if (!redeemRequestId || typeof redeemRequestId !== "string") {
    throw new Error("A redeem request id is required to consume a Codex reset credit.");
  }

  let response;
  let data = null;
  try {
    response = await proxyAwareFetch(CODEX_CONFIG.resetCreditsConsumeUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ redeem_request_id: redeemRequestId }),
    }, proxyOptions);

    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to consume Codex reset credit: ${error.message}`);
  }

  const code = data?.code || null;
  const windowsReset = toFiniteNumber(data?.windows_reset, 0);
  const success = response.ok && (code === "reset" || windowsReset > 0);

  return {
    ok: success,
    noCredit: response.ok && code === "no_credit",
    status: response.status,
    code,
    windowsReset,
    message: data?.message || null,
    raw: data,
  };
}

// ponytail: minimal expiry helper; add retry/backoff or org-list caching when needed
export async function getCodexSubscriptionEntitlement({ accessToken, idToken, providerSpecificData, proxyOptions, force = false, now = Date.now() } = {}) {
  const psd = providerSpecificData || {};
  const nowMs = typeof now === "number" ? now : Date.now();
  let nowIso;
  try { nowIso = new Date(nowMs).toISOString(); } catch { nowIso = new Date().toISOString(); }
  const jwtPayload = decodeJwtPayload(idToken);
  const accessTokenPayload = decodeJwtPayload(accessToken);
  const accessTokenHints = getCodexSubscriptionHints(accessTokenPayload);
  const idTokenHints = getCodexSubscriptionHints(jwtPayload);

  const cachedPlanNorm = normalizeCodexPlan(psd.codexSubscriptionPlan);
  const isCachedFree = cachedPlanNorm === "free";
  const safeCachedExpiry = (() => {
    if (isCachedFree) return null;
    const iso = normalizeSubscriptionIso(psd.codexSubscriptionActiveUntil);
    const ms = iso ? new Date(iso).getTime() : NaN;
    if (iso && Number.isFinite(ms) && ms > nowMs) return iso;
    return null;
  })();
  const safeCachedSnapshot = (() => {
    if (isCachedFree) return { activeUntil: null, plan: "free", source: psd.codexSubscriptionSource || "accounts" };
    if (safeCachedExpiry) return { activeUntil: safeCachedExpiry, plan: cachedPlanNorm || psd.codexSubscriptionPlan || null, source: psd.codexSubscriptionSource || null };
    return null;
  })();

  try {
    const rawClaim = getJwtSubscriptionClaimFromPayload(jwtPayload);
    const normalized = normalizeSubscriptionIso(rawClaim);
    if (normalized) {
      const claimTime = new Date(normalized).getTime();
      if (Number.isFinite(claimTime) && claimTime > nowMs) {
        if (!force) {
          const rawPlan = getJwtPlanFromPayload(jwtPayload);
          const plan = normalizeCodexPlan(rawPlan);
          const isJwtFree = plan === "free";
          const jwtActiveUntil = isJwtFree ? null : normalized;
          const hasStoredMeta = Boolean(psd.codexSubscriptionSource || psd.codexSubscriptionPlan != null || psd.codexSubscriptionActiveUntil !== undefined || psd.codexSubscriptionFetchedAt);
          const fetchedAtMs = psd.codexSubscriptionFetchedAt ? new Date(psd.codexSubscriptionFetchedAt).getTime() : NaN;
          const ttlExpired = !Number.isFinite(fetchedAtMs) || nowMs - fetchedAtMs >= 6 * 60 * 60 * 1000;
          const psdExpiryNorm = normalizeSubscriptionIso(psd.codexSubscriptionActiveUntil);
          const sameMetadata = hasStoredMeta && cachedPlanNorm === plan && (isJwtFree ? psd.codexSubscriptionActiveUntil == null : psdExpiryNorm === normalized) && psd.codexSubscriptionSource === "idToken";
          if (hasStoredMeta && sameMetadata && !ttlExpired) {
            return { subscriptionActiveUntil: jwtActiveUntil, subscriptionPlan: plan, subscriptionSource: "idToken", patch: {} };
          }
        }
      }
    }
  } catch {}

  if (!force) {
    const fetchedAtMs = psd.codexSubscriptionFetchedAt ? new Date(psd.codexSubscriptionFetchedAt).getTime() : NaN;
    if (Number.isFinite(fetchedAtMs) && nowMs - fetchedAtMs < 6 * 60 * 60 * 1000) {
      if (safeCachedSnapshot) return { subscriptionActiveUntil: safeCachedSnapshot.activeUntil, subscriptionPlan: safeCachedSnapshot.plan, subscriptionSource: safeCachedSnapshot.source, patch: {} };
      if (!accessToken) return { subscriptionActiveUntil: null, subscriptionPlan: null, subscriptionSource: null, patch: { codexSubscriptionAttemptAt: nowIso } };
    } else {
      const attemptAtMs = psd.codexSubscriptionAttemptAt ? new Date(psd.codexSubscriptionAttemptAt).getTime() : NaN;
      if (Number.isFinite(attemptAtMs) && nowMs - attemptAtMs < 30 * 60 * 1000) {
        if (safeCachedSnapshot) return { subscriptionActiveUntil: safeCachedSnapshot.activeUntil, subscriptionPlan: safeCachedSnapshot.plan, subscriptionSource: safeCachedSnapshot.source, patch: {} };
        if (!accessToken) return { subscriptionActiveUntil: null, subscriptionPlan: null, subscriptionSource: null, patch: { codexSubscriptionAttemptAt: nowIso } };
      }
    }
  }

  if (!accessToken) {
    if (safeCachedSnapshot) return { subscriptionActiveUntil: safeCachedSnapshot.activeUntil, subscriptionPlan: safeCachedSnapshot.plan, subscriptionSource: safeCachedSnapshot.source, patch: { codexSubscriptionAttemptAt: nowIso } };
    return { subscriptionActiveUntil: null, subscriptionPlan: null, subscriptionSource: null, patch: { codexSubscriptionAttemptAt: nowIso } };
  }

  try {
    const cfg = U("codex");
    const accountsCheckUrl = cfg.accountsCheckUrl;
    const subscriptionsUrl = cfg.subscriptionsUrl;
    if (!accountsCheckUrl) throw new Error("missing accountsCheckUrl");
    const psdOrgId = normalizeSubscriptionId(psd.organizationId || psd.chatgptOrganizationId || psd.orgId);
    const psdId = normalizeSubscriptionId(psd.chatgptAccountId || psd.workspaceId || psd.accountId);
    const requestAccountId = accessTokenHints.accountId || psdId || idTokenHints.accountId;
    const offsetMin = -new Date().getTimezoneOffset();
    const url = `${accountsCheckUrl}?timezone_offset_min=${encodeURIComponent(String(offsetMin))}`;
    const resp = await proxyAwareFetch(url, {
      method: "GET",
      headers: buildCodexSubscriptionHeaders(accessToken, url, requestAccountId),
    }, proxyOptions);
    if (!resp.ok) throw new Error(`accounts check ${resp.status}`);
    let data;
    try { data = await resp.json(); } catch { throw new Error("malformed accounts json"); }

    const accounts = collectCodexSubscriptionAccounts(data);
    const accessOrgId = accessTokenHints.organizationId;
    const accessId = accessTokenHints.accountId;
    const idTokenOrgId = idTokenHints.organizationId;
    const idTokenId = idTokenHints.accountId;

    let selected = null;
    const accountKeys = (a) => [a._accountMapKey, a.id, a.account_id, a.chatgpt_account_id, a.accountId, a.organization_id, a.org_id, a.workspace_id].map(normalizeSubscriptionId).filter(Boolean);
    const byId = (id) => accounts.find((a) => accountKeys(a).includes(String(id).trim()));
    const byOrgMatch = (orgId) => accounts.find((a) => {
      const keys = [a._accountMapKey, a.organization_id, a.org_id, a.workspace_id, a.chatgpt_account_id, a.id, a.account_id, a.accountId].map(normalizeSubscriptionId).filter(Boolean);
      return keys.includes(normalizeSubscriptionId(orgId));
    });
    const planForSelection = (a) => a.subscription_plan ?? a.plan_type ?? a.planType ?? a.plan ?? a.entitlement?.subscription_plan ?? a.entitlement?.plan_type ?? a.entitlement?.plan ?? null;
    if (accessOrgId) selected = byOrgMatch(accessOrgId) || byId(accessOrgId) || null;
    if (!selected && psdOrgId) selected = byOrgMatch(psdOrgId) || byId(psdOrgId) || null;
    if (!selected && idTokenOrgId) selected = byOrgMatch(idTokenOrgId) || byId(idTokenOrgId) || null;
    if (!selected && accessId) selected = byId(accessId) || null;
    if (!selected && psdId) selected = byId(psdId) || null;
    if (!selected && idTokenId) selected = byId(idTokenId) || null;
    if (!selected) {
      const nonFree = accounts.filter((a) => {
        const raw = planForSelection(a);
        const norm = normalizeCodexPlan(raw);
        const cand = norm != null ? String(norm).trim().toLowerCase() : String(raw ?? "").trim().toLowerCase();
        return cand && cand !== "free";
      });
      if (nonFree.length) {
        selected = nonFree.find((a) => a.is_default === true || a.isDefault === true) || nonFree[0];
      }
    }
    if (!selected) selected = accounts.find((a) => a.is_default === true || a.isDefault === true) || null;
    if (!selected && accounts.length) selected = accounts[0];
    if (!selected) throw new Error("no account selected");

    let plan = null;
    let expiresRaw = null;
    let source = "accounts";
    if (selected.entitlement && typeof selected.entitlement === "object" && !Array.isArray(selected.entitlement)) {
      plan = selected.entitlement.subscription_plan || selected.entitlement.plan_type || selected.entitlement.plan || null;
      expiresRaw = selected.entitlement.expires_at || selected.entitlement.expiresAt || selected.entitlement.active_until || selected.entitlement.activeUntil || null;
    }
    if (!plan) plan = selected.subscription_plan || selected.plan_type || selected.planType || selected.plan || null;
    if (!expiresRaw) expiresRaw = selected.expires_at || selected.expiresAt || selected.active_until || selected.activeUntil || null;
    plan = normalizeCodexPlan(plan);
    let normalizedExpiry = normalizeSubscriptionIso(expiresRaw);
    // Free is authoritative: valid with missing/past expiry, no subscriptions resurrection
    const isFreePlan = typeof plan === "string" && plan.toLowerCase() === "free";
    if (isFreePlan) {
      return {
        subscriptionActiveUntil: null,
        subscriptionPlan: "free",
        subscriptionSource: "accounts",
        patch: {
          codexSubscriptionActiveUntil: null,
          codexSubscriptionPlan: "free",
          codexSubscriptionSource: "accounts",
          codexSubscriptionFetchedAt: nowIso,
          codexSubscriptionAttemptAt: nowIso,
        },
      };
    }
    const expiryMs = normalizedExpiry ? new Date(normalizedExpiry).getTime() : NaN;
    const isExpired = !normalizedExpiry || !Number.isFinite(expiryMs) || expiryMs <= nowMs;
    const accountsPlanSnapshot = plan;
    const accountsExpirySnapshot = normalizedExpiry;
    const accountsExpiryMsSnapshot = expiryMs;

    if ((!plan || isExpired) && subscriptionsUrl) {
      const accountIdForSub = normalizeSubscriptionId(
        selected.id || selected.account_id || selected.chatgpt_account_id || selected.accountId ||
        selected._accountMapKey || accessId || psdId || idTokenId,
      );
      if (accountIdForSub) {
        try {
          const subUrl = `${subscriptionsUrl}?account_id=${encodeURIComponent(accountIdForSub)}`;
          const subResp = await proxyAwareFetch(subUrl, {
            method: "GET",
            headers: buildCodexSubscriptionHeaders(accessToken, subUrl, accountIdForSub),
          }, proxyOptions);
          if (subResp.ok) {
            let subData;
            try { subData = await subResp.json(); } catch { subData = null; }
            if (subData) {
              let subObj = subData;
              if (Array.isArray(subData)) subObj = subData[0] || {};
              else if (subData.data && Array.isArray(subData.data)) subObj = subData.data[0] || subData;
              else if (subData.subscriptions && Array.isArray(subData.subscriptions)) subObj = subData.subscriptions[0] || subData;
              const fallbackPlan = subObj.subscription_plan || subObj.plan_type || subObj.planType || subObj.plan || null;
              const normFallbackPre = normalizeCodexPlan(fallbackPlan);
              if (normFallbackPre === "free") {
                plan = "free";
                normalizedExpiry = null;
                source = "subscriptions";
                return {
                  subscriptionActiveUntil: null,
                  subscriptionPlan: "free",
                  subscriptionSource: "subscriptions",
                  patch: { codexSubscriptionActiveUntil: null, codexSubscriptionPlan: "free", codexSubscriptionSource: "subscriptions", codexSubscriptionFetchedAt: nowIso, codexSubscriptionAttemptAt: nowIso },
                };
              }
              const fallbackExpires = subObj.active_until || subObj.expires_at || subObj.activeUntil || subObj.expiresAt || null;
              const fallbackIso = normalizeSubscriptionIso(fallbackExpires);
              const fallbackMs = fallbackIso ? new Date(fallbackIso).getTime() : NaN;
              const fallbackIsFuture = fallbackIso && Number.isFinite(fallbackMs) && fallbackMs > nowMs;
              if (fallbackIsFuture) {
                const normFallback = normalizeCodexPlan(fallbackPlan);
                if (normFallback) plan = normFallback;
                else if (fallbackPlan && typeof fallbackPlan === "string" && fallbackPlan.trim()) plan = fallbackPlan.trim().toLowerCase();
                normalizedExpiry = fallbackIso;
                source = "subscriptions";
              }
            }
          }
        } catch {}
      }
    }

    let finalExpiryMs = normalizedExpiry ? new Date(normalizedExpiry).getTime() : NaN;
    const normalizedIsPast = normalizedExpiry && Number.isFinite(finalExpiryMs) && finalExpiryMs <= nowMs;
    const hasFutureAccountsSnapshot = accountsExpirySnapshot && Number.isFinite(accountsExpiryMsSnapshot) && accountsExpiryMsSnapshot > nowMs;
    const psdExpiryIso = psd.codexSubscriptionActiveUntil || null;
    const psdExpiryMs = psdExpiryIso ? new Date(psdExpiryIso).getTime() : NaN;
    const hasFuturePsdCache = psdExpiryIso && Number.isFinite(psdExpiryMs) && psdExpiryMs > nowMs;
    if (normalizedIsPast || !normalizedExpiry || !Number.isFinite(finalExpiryMs)) {
      if (hasFutureAccountsSnapshot) {
        normalizedExpiry = accountsExpirySnapshot;
        if (!plan) plan = accountsPlanSnapshot;
        source = "accounts";
        finalExpiryMs = accountsExpiryMsSnapshot;
      } else if (hasFuturePsdCache) {
        normalizedExpiry = psdExpiryIso;
        if (!plan) {
          const psdNorm = normalizeCodexPlan(psd.codexSubscriptionPlan);
          plan = psdNorm || psd.codexSubscriptionPlan || plan;
        }
        source = psd.codexSubscriptionSource || "accounts";
        finalExpiryMs = psdExpiryMs;
      }
    }
    finalExpiryMs = normalizedExpiry ? new Date(normalizedExpiry).getTime() : NaN;
    if (!normalizedExpiry || !Number.isFinite(finalExpiryMs) || finalExpiryMs <= nowMs) throw new Error("no valid expiry");

    plan = normalizeCodexPlan(plan) || (typeof plan === "string" ? plan.trim() || null : plan);

    return {
      subscriptionActiveUntil: normalizedExpiry,
      subscriptionPlan: plan || null,
      subscriptionSource: source,
      patch: {
        codexSubscriptionActiveUntil: normalizedExpiry,
        codexSubscriptionPlan: plan || null,
        codexSubscriptionSource: source,
        codexSubscriptionFetchedAt: nowIso,
        codexSubscriptionAttemptAt: nowIso,
      },
    };
  } catch {
    if (safeCachedSnapshot) {
      return {
        subscriptionActiveUntil: safeCachedSnapshot.activeUntil,
        subscriptionPlan: safeCachedSnapshot.plan,
        subscriptionSource: safeCachedSnapshot.source,
        patch: { codexSubscriptionAttemptAt: nowIso },
      };
    }
    return {
      subscriptionActiveUntil: null,
      subscriptionPlan: null,
      subscriptionSource: null,
      patch: { codexSubscriptionAttemptAt: nowIso },
    };
  }
}
