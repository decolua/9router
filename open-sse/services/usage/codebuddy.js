import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime } from "./shared.js";

const CODEBUDDY_CONFIG = {
  usageUrl: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
  browserUsageUrl: "https://www.codebuddy.ai/billing/meter/get-user-resource",
  productCode: "p_tcaca",
  packageCodes: {
    free: "TCACA_code_001_PqouKr6QWV",
    proMon: "TCACA_code_002_AkiJS3ZHF5",
    gift: "TCACA_code_006_DbXS0lrypC",
    activity: "TCACA_code_007_nzdH5h4Nl0",
    proYear: "TCACA_code_003_FAnt7lcmRT",
    freeMon: "TCACA_code_008_cfWoLwvjU4",
    extra: "TCACA_code_009_0XmEQc2xOf",
  },
};

function hasQuotaRows(usage) {
  return usage?.quotas && Object.keys(usage.quotas).length > 0;
}

async function fetchCodeBuddyUid(accessToken, providerSpecificData = {}, proxyOptions = null) {
  const cachedUid = providerSpecificData?.uid || providerSpecificData?.rawAuth?.uid;
  if (cachedUid) {
    return {
      uid: cachedUid,
      enterpriseId: providerSpecificData?.enterpriseId || providerSpecificData?.rawAuth?.enterpriseId || null,
    };
  }

  const domain = providerSpecificData?.domain || providerSpecificData?.rawAuth?.domain || "www.codebuddy.ai";
  try {
    const response = await proxyAwareFetch(`https://${domain}/v2/plugin/accounts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Domain": domain,
      },
    }, proxyOptions);

    if (!response.ok) return { uid: null, enterpriseId: null };

    const body = await response.json();
    const accounts = body?.data?.accounts || [];
    const account = accounts.find((entry) => entry.lastLogin) || accounts[0] || {};
    return {
      uid: account.uid || null,
      enterpriseId: account.enterpriseId || null,
    };
  } catch {
    return { uid: null, enterpriseId: null };
  }
}

export async function getCodeBuddyUsage(accessToken, providerSpecificData = {}, proxyOptions = null, apiKey = null) {
  const webCookie = normalizeCodeBuddyCookie(providerSpecificData?.webCookie);

  if (!accessToken) {
    if (webCookie) {
      const cookieUsage = await fetchCodeBuddyCookieUsage(webCookie, providerSpecificData, proxyOptions);
      if (cookieUsage) {
        return {
          ...cookieUsage,
          authMode: apiKey ? "generated-api-key+web-cookie" : "web-cookie",
          trackingMode: "upstream-cookie",
        };
      }
    }

    if (apiKey) {
      return {
        plan: "CodeBuddy",
        message: "CodeBuddy chat key active. Upstream quota is unavailable without a valid IDE OAuth token; use 9router Usage for local request and token tracking.",
        quotas: {},
        authMode: "generated-api-key",
        trackingMode: "local-router",
      };
    }
    return {
      plan: "CodeBuddy",
      message: "CodeBuddy upstream quota is unavailable because no valid IDE OAuth token is stored.",
      quotas: {},
      trackingMode: "unavailable",
    };
  }

  try {
    const { uid, enterpriseId } = await fetchCodeBuddyUid(accessToken, providerSpecificData, proxyOptions);
    const response = await proxyAwareFetch(CODEBUDDY_CONFIG.usageUrl, {
      method: "POST",
      headers: buildCodeBuddyUsageHeaders(accessToken, providerSpecificData, uid, enterpriseId),
      body: JSON.stringify(buildCodeBuddyUsageBody()),
    }, proxyOptions);

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (response.status === 401 || response.status === 403) {
      if (webCookie) {
        const cookieUsage = await fetchCodeBuddyCookieUsage(webCookie, providerSpecificData, proxyOptions);
        if (cookieUsage) {
          return {
            ...cookieUsage,
            authMode: "oauth-rejected+web-cookie",
            trackingMode: "upstream-cookie",
          };
        }
      }

      return {
        plan: "CodeBuddy",
        message: `CodeBuddy IDE OAuth token was rejected (${response.status}). Upstream quota is unavailable; use 9router Usage for local request and token tracking.`,
        quotas: {},
        authMode: "oauth-rejected",
        trackingMode: "local-router",
      };
    }

    if (!response.ok) {
      if (webCookie) {
        const cookieUsage = await fetchCodeBuddyCookieUsage(webCookie, providerSpecificData, proxyOptions);
        if (cookieUsage) {
          return {
            ...cookieUsage,
            authMode: "oauth-error+web-cookie",
            trackingMode: "upstream-cookie",
          };
        }
      }

      return {
        plan: "CodeBuddy",
        message: `CodeBuddy quota endpoint returned ${response.status}.`,
        quotas: {},
      };
    }

    const usage = parseCodeBuddyUsage(payload);
    if (!hasQuotaRows(usage) && webCookie) {
      const cookieUsage = await fetchCodeBuddyCookieUsage(webCookie, providerSpecificData, proxyOptions);
      if (cookieUsage && (hasQuotaRows(cookieUsage) || !usage?.message)) {
        return {
          ...cookieUsage,
          authMode: "oauth+web-cookie",
          trackingMode: "upstream-cookie",
        };
      }
    }

    return {
      ...usage,
      authMode: "oauth",
    };
  } catch (error) {
    if (webCookie) {
      const cookieUsage = await fetchCodeBuddyCookieUsage(webCookie, providerSpecificData, proxyOptions);
      if (cookieUsage) {
        return {
          ...cookieUsage,
          authMode: "oauth-error+web-cookie",
          trackingMode: "upstream-cookie",
        };
      }
    }

    return {
      plan: "CodeBuddy",
      message: `CodeBuddy connected. Unable to fetch quota: ${error.message}`,
      quotas: {},
    };
  }
}

function formatCodeBuddyDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeCodeBuddyCookie(cookie) {
  return String(cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("; ");
}

function buildCodeBuddyUsageBody() {
  return buildCodeBuddyUsageBodyWithOptions();
}

function buildCodeBuddyUsageBodyWithOptions({ includePackageCodes = false } = {}) {
  const now = new Date();
  const rangeEnd = new Date(now);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 101);

  const body = {
    PageNumber: 1,
    PageSize: 200,
    ProductCode: CODEBUDDY_CONFIG.productCode,
    Status: [0, 3],
    PackageEndTimeRangeBegin: formatCodeBuddyDate(now),
    PackageEndTimeRangeEnd: formatCodeBuddyDate(rangeEnd),
  };

  if (includePackageCodes) {
    body.PackageCodes = Object.values(CODEBUDDY_CONFIG.packageCodes);
  }

  return body;
}

function buildCodeBuddyUsageHeaders(accessToken, providerSpecificData = {}, uid = null, enterpriseId = null) {
  const domain = providerSpecificData?.domain || providerSpecificData?.rawAuth?.domain || "www.codebuddy.ai";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Content-Type": "application/json",
    "X-Domain": domain,
  };

  if (uid) headers["X-User-Id"] = uid;
  if (enterpriseId) {
    headers["X-Enterprise-Id"] = enterpriseId;
    headers["X-Tenant-Id"] = enterpriseId;
  }

  return headers;
}

async function fetchCodeBuddyCookieUsage(webCookie, providerSpecificData = {}, proxyOptions = null) {
  if (!webCookie) return null;

  try {
    const response = await proxyAwareFetch(CODEBUDDY_CONFIG.browserUsageUrl, {
      method: "POST",
      headers: buildCodeBuddyCookieUsageHeaders(webCookie, providerSpecificData),
      body: JSON.stringify(buildCodeBuddyUsageBodyWithOptions({ includePackageCodes: true })),
    }, proxyOptions);

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) return null;

    return parseCodeBuddyUsage(payload);
  } catch {
    return null;
  }
}

function buildCodeBuddyCookieUsageHeaders(webCookie, providerSpecificData = {}) {
  const domain = providerSpecificData?.domain || providerSpecificData?.rawAuth?.domain || "www.codebuddy.ai";
  return {
    Cookie: webCookie,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "X-Requested-With": "XMLHttpRequest",
    "X-Domain": domain,
    Origin: `https://${domain}`,
    Referer: `https://${domain}/profile/usage`,
  };
}

function parseCodeBuddyUsage(payload) {
  const data = payload?.data?.Response?.Data || payload?.Response?.Data || payload?.data || payload || {};
  const accounts = Array.isArray(data?.Accounts)
    ? data.Accounts
    : Array.isArray(data?.accounts)
      ? data.accounts
      : [];

  if (accounts.length === 0) {
    return {
      plan: "CodeBuddy",
      message: "CodeBuddy connected. No quota records were returned.",
      quotas: {},
    };
  }

  const quotas = {};
  let hasProPackage = false;

  for (const account of accounts) {
    if (!account || typeof account !== "object") continue;
    const label = getCodeBuddyQuotaLabel(account.PackageCode);
    if (!label) continue;

    if (account.PackageCode === CODEBUDDY_CONFIG.packageCodes.proMon || account.PackageCode === CODEBUDDY_CONFIG.packageCodes.proYear) {
      hasProPackage = true;
    }

    const quota = getCodeBuddyQuotaValues(account);
    if (!quota) continue;

    if (!quotas[label]) {
      quotas[label] = {
        used: 0,
        total: 0,
        remaining: 0,
        resetAt: null,
        unit: "credits",
        unlimited: false,
      };
    }

    quotas[label].used += quota.used;
    quotas[label].total += quota.total;
    quotas[label].remaining += quota.remaining;
    quotas[label].resetAt = getEarlierReset(quotas[label].resetAt, quota.resetAt);
  }

  if (Object.keys(quotas).length === 0) {
    return {
      plan: hasProPackage ? "Pro" : "Free",
      message: "CodeBuddy connected. Unable to extract quota values.",
      quotas: {},
    };
  }

  for (const quota of Object.values(quotas)) {
    quota.remainingPercentage = quota.total > 0
      ? Math.max(0, Math.min(100, (quota.remaining / quota.total) * 100))
      : 0;
  }

  return {
    plan: hasProPackage ? "Pro" : "Free",
    quotas,
  };
}

function getCodeBuddyQuotaLabel(packageCode) {
  const codes = CODEBUDDY_CONFIG.packageCodes;
  switch (packageCode) {
    case codes.free:
    case codes.freeMon:
    case codes.proMon:
    case codes.proYear:
      return "Monthly Credits";
    case codes.gift:
      return "Gift Credits";
    case codes.extra:
      return "Extra Credits";
    case codes.activity:
      return "Activity Credits";
    default:
      return packageCode ? "Other Credits" : null;
  }
}

function getCodeBuddyQuotaValues(account) {
  const total = firstFiniteNumber(
    account.CycleCapacitySizePrecise,
    account.CycleCapacitySize,
    account.CapacitySizePrecise,
    account.CapacitySize,
  );
  const remaining = firstFiniteNumber(
    account.CycleCapacityRemainPrecise,
    account.CapacityRemainPrecise,
    account.CapacityRemain,
  );
  const used = firstFiniteNumber(
    account.CapacityUsedPrecise,
    account.CapacityUsed,
    total !== null && remaining !== null ? Math.max(0, total - remaining) : null,
  );

  if (total === null && remaining === null && used === null) return null;

  const safeTotal = Math.max(0, total ?? ((used ?? 0) + (remaining ?? 0)));
  const safeRemaining = Math.max(0, remaining ?? Math.max(0, safeTotal - (used ?? 0)));
  const safeUsed = Math.max(0, used ?? Math.max(0, safeTotal - safeRemaining));

  return {
    total: safeTotal,
    remaining: safeRemaining,
    used: safeUsed,
    resetAt: parseResetTime(account.CycleEndTime || account.DeductionEndTime || account.ExpiredTime),
  };
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function getEarlierReset(current, next) {
  if (!current) return next || null;
  if (!next) return current;
  return new Date(next).getTime() < new Date(current).getTime() ? next : current;
}
