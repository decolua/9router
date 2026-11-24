/**
 * QwenWork usage — the account-context envelope.
 *
 * QwenWork (gateway.qwenwork.cn) has no /api/v2/quota/usage endpoint; its
 * sign-in already reads /api/v1/adapter/user/account-context, which carries
 * plan {name, next_refresh / next_due} and quota {total, used, remaining,
 * exceeded} in the plan's credit unit. Auth is a plain Bearer of the device
 * token — no COSY signing (same as Qoder's quota path).
 *
 * Shape ported from magpie-community/plugins PR #319 (parseAccountContext).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return String(Math.round(n * 100) / 100);
};

function unwrap(v) {
  return v?.data && typeof v.data === "object" && !Array.isArray(v.data) ? v.data : (v && typeof v === "object" ? v : {});
}

export async function getQwenworkUsage(accessToken, url, proxyOptions = null) {
  if (!accessToken) {
    return { message: "QwenWork usage unavailable: no access token" };
  }
  if (!url) {
    return { message: "QwenWork usage unavailable: no account-context URL configured" };
  }
  const fetchImpl = proxyOptions?.proxyFetch || proxyAwareFetch;
  try {
    const response = await fetchImpl(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions?.proxyFetch ? null : proxyOptions,
    );
    if (!response.ok) {
      return { message: `QwenWork connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "QwenWork connected. Usage response was not JSON." };
    }
    const data = unwrap(body);
    const plan = data.plan && typeof data.plan === "object" ? data.plan : {};
    const q = data.quota && typeof data.quota === "object" && !Array.isArray(data.quota) ? data.quota : null;

    const result = {};
    if (plan.name) result.planName = String(plan.name);
    const refresh = plan.next_refresh_date ?? plan.next_due_date;
    if (refresh) {
      const at = new Date(refresh).getTime();
      if (!Number.isNaN(at) && at > 0) result.resetAt = new Date(at).toISOString();
    }
    if (q) {
      const total = Number(q.total);
      const remaining = Number(q.remaining);
      const used = Number.isFinite(Number(q.used)) ? Number(q.used) : (Number.isFinite(total) && Number.isFinite(remaining) ? total - remaining : NaN);
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0) {
        result.quotas = {
          user: {
            total,
            used,
            remaining: Number.isFinite(remaining) ? remaining : total - used,
            unit: "credits",
            resetAt: result.resetAt || null,
            neverExpires: false,
          },
        };
      } else if (Number.isFinite(remaining)) {
        // A personal account reports only what is left: no total to show a
        // share of — report the balance as a remaining-only row.
        result.quotas = {
          user: {
            total: 0,
            used: 0,
            remaining,
            unit: "credits",
            resetAt: result.resetAt || null,
            neverExpires: false,
          },
        };
        result.balance = `${num(remaining)} credits`;
      }
      const exceeded = q.exceeded === true || q.is_quota_exceeded === true || q.isQuotaExceeded === true || remaining <= 0;
      if (exceeded) result.exhausted = true;
    }
    if (!result.quotas && result.balance === undefined) {
      return { message: "QwenWork connected. The account reports no credits." };
    }
    return result;
  } catch (error) {
    return { message: `QwenWork usage error: ${error.message}` };
  }
}
