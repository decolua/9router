import { getAdapter } from "@/lib/db/driver.js";
import { num, localQuota } from "./quotaShared.js";

export function getAlibabaPlanLimits(limits = {}) {
  // Token Plan no longer ships a 5-hour window — quota is weekly only
  // (measured in credits). Lite = 2500 credits / 7d.
  const plans = {
    lite: { name: "Lite", limit7d: 2500 },
    standard: { name: "Standard", limit7d: 10000 },
    pro: { name: "Pro", limit7d: 40000 },
  };
  const key = String(limits.plan || limits.tier || limits.tokenPlan || "lite")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return plans[key] || plans.lite;
}

export function estimateAlibabaCredits(record) {
  let prompt = num(record?.promptTokens, 0);
  let completion = num(record?.completionTokens, 0);
  let cached = 0;
  let raw = record?.tokens;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (raw && typeof raw === "object") {
    prompt = num(raw.prompt_tokens ?? raw.promptTokens, prompt);
    completion = num(raw.completion_tokens ?? raw.completionTokens, completion);
    cached = num(raw.cached_tokens ?? raw.cachedTokens, 0);
  }
  const uncached = Math.max(0, prompt - cached);
  // qwen3.8 list USD / 1M × ~$0.002 per Token Plan credit.
  const usd = uncached * 2e-6 + completion * 6e-6 + cached * 0.25e-6;
  return usd / 0.002;
}

export function alibabaWindowMeta(records, windowMs, now, useCredits) {
  const items = [];
  if (Array.isArray(records)) {
    for (const r of records) {
      const t =
        typeof r?.timestamp === "number"
          ? r.timestamp
          : r?.timestamp
            ? new Date(r.timestamp).getTime()
            : NaN;
      if (!Number.isFinite(t) || t > now) continue;
      const amount = useCredits
        ? estimateAlibabaCredits(r)
        : num(r?.promptTokens, 0) + num(r?.completionTokens, 0);
      items.push({ t, amount });
    }
  }
  items.sort((a, b) => a.t - b.t);
  let start = null;
  let end = null;
  for (const item of items) {
    if (start === null || item.t >= end) {
      start = item.t;
      end = item.t + windowMs;
    }
  }
  if (start === null || now >= end) return { used: 0, start: null, end: null };
  let used = 0;
  for (const item of items) {
    if (item.t >= start && item.t < end) used += item.amount;
  }
  return { used, start, end };
}

export function alibabaWindowUsage(records, windowMs, now, useCredits) {
  return alibabaWindowMeta(records, windowMs, now, useCredits).used;
}

export function alibabaUntracked7d(limits, windowStart) {
  const extra = num(limits?.untrackedCredits7d ?? limits?.quotaUsed7dOffset, 0);
  if (extra <= 0) return 0;
  const raw = limits?.untrackedCredits7dWindowStart ?? limits?.quotaUsed7dWindowStart;
  if (raw == null || raw === "") return extra;
  const hintedStart = typeof raw === "number" ? raw : new Date(raw).getTime();
  if (!Number.isFinite(hintedStart) || !Number.isFinite(windowStart)) return 0;
  return Math.abs(hintedStart - windowStart) < 2000 ? extra : 0;
}

export function calcSlidingWindowUsage(records, now = Date.now(), limits = {}) {
  const sevenDayMs = 7 * 86400 * 1000;
  const cutoff7d = now - sevenDayMs;
  const useCredits = String(limits?.unit || "").toLowerCase() === "credits";
  const plan = getAlibabaPlanLimits(limits);

  let sevenDayUsed = 0;
  let sevenDayEnd = null;
  if (useCredits) {
    const meta = alibabaWindowMeta(records, sevenDayMs, now, true);
    sevenDayUsed = meta.used + alibabaUntracked7d(limits, meta.start);
    sevenDayEnd = meta.end;
  } else if (Array.isArray(records)) {
    for (const r of records) {
      const t =
        typeof r?.timestamp === "number"
          ? r.timestamp
          : r?.timestamp
            ? new Date(r.timestamp).getTime()
            : NaN;
      if (!Number.isFinite(t) || t < cutoff7d || t > now) continue;
      sevenDayUsed += num(r?.promptTokens, 0) + num(r?.completionTokens, 0);
    }
  }

  const limit7d = num(
    limits?.limit7d || limits?.quotaLimit7d || limits?.sevenDayLimit,
    useCredits ? plan.limit7d : 0,
  );
  const name7d = useCredits ? "Créditos 7d (estimado)" : "Consumo 7d (medido local)";
  const quota7d = localQuota(sevenDayUsed, limit7d);
  if (sevenDayEnd) quota7d.resetAt = new Date(sevenDayEnd).toISOString();
  const quotas = {
    [name7d]: quota7d,
  };

  return {
    plan: useCredits
      ? `Alibaba Token Plan ${plan.name} (créditos estimados)`
      : "Alibaba Token Plan (medido pelo router)",
    status: "ok",
    source: "router-local",
    fetchedAt: new Date(now).toISOString(),
    quotas,
  };
}

// The plan's credit coefficients are not published (the console says credits
// "are dynamically determined by model type, token usage, thinking mode and
// tool calls"), so the local estimate can land far below the real drawdown —
// e.g. a plan the vendor already paused read 22% used here. A fresh vendor 429
// is therefore authoritative: it proves the 7-day window is exhausted and
// carries the reset instant.
const QUOTA_EXHAUSTED_RE = /token-plan[^"]*quota has been exhausted/i;
const QUOTA_RESET_RE = /reset at (\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC/i;

export function parseAlibabaResetAt(message, now = Date.now()) {
  const m = QUOTA_RESET_RE.exec(String(message || ""));
  if (!m) return null;
  const [, mm, dd, hh, mi, ss] = m;
  const year = new Date(now).getUTCFullYear();
  const build = (y) => Date.UTC(y, Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  // The vendor prints no year: a reset that is already behind us belongs to the
  // next one.
  return new Date(build(year) > now - 86400000 ? build(year) : build(year + 1)).toISOString();
}

export function alibabaQuotaExhaustion(lastError, lastErrorAt, now = Date.now()) {
  const message = String(lastError || "");
  if (!QUOTA_EXHAUSTED_RE.test(message)) return null;
  const at =
    typeof lastErrorAt === "number"
      ? lastErrorAt
      : lastErrorAt
        ? new Date(lastErrorAt).getTime()
        : NaN;
  if (!Number.isFinite(at) || at > now) return null;
  if (now - at > 7 * 86400 * 1000) return null;
  return { at, resetAt: parseAlibabaResetAt(message, now) };
}

export function applyAlibabaQuotaExhaustion(result, ctx = {}, records = [], now = Date.now()) {
  const signal = alibabaQuotaExhaustion(ctx?.lastError, ctx?.lastErrorAt, now);
  if (!signal) return result;
  // A call that succeeded after the 429 means the account was restored (plan
  // upgrade, Extra Bundle, vendor quota reset) — stop reporting it exhausted.
  if (
    Array.isArray(records) &&
    records.some((r) => {
      const t =
        typeof r?.timestamp === "number"
          ? r.timestamp
          : r?.timestamp
            ? new Date(r.timestamp).getTime()
            : NaN;
      return (
        Number.isFinite(t) &&
        t > signal.at &&
        num(r?.promptTokens, 0) + num(r?.completionTokens, 0) > 0
      );
    })
  ) {
    return result;
  }
  const quota = result?.quotas?.[Object.keys(result.quotas)[0]];
  if (!quota || !(quota.total > 0)) return result;
  quota.used = quota.total;
  quota.remainingPercentage = 0;
  if (signal.resetAt) quota.resetAt = signal.resetAt;
  return result;
}

function parseConnectionData(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function getAlibabaTokenPlanUsage(ctx = {}, now = Date.now()) {
  let connId = String(ctx?.connectionId || ctx?.id || "").trim();
  const psd = ctx?.providerSpecificData || {};
  const sevenDayMs = 7 * 86400 * 1000;
  const cutoff7dIso = new Date(now - sevenDayMs).toISOString();

  let rows = [];
  let connData = null;
  try {
    const db = await getAdapter();
    if (db && typeof db.get === "function") {
      // The dispatcher hands handlers a narrowed ctx, so read the vendor error
      // (lastError/lastErrorAt) straight from the connection row.
      const connRow = connId
        ? db.get("SELECT data FROM providerConnections WHERE id = ?", [connId])
        : ctx?.apiKey
          ? db.get(
              "SELECT id, data FROM providerConnections WHERE provider IN ('alitp-intl', 'qwen-cloud-token-plan') AND json_extract(data, '$.apiKey') = ?",
              [String(ctx.apiKey)]
            )
          : null;
      connId = String(connRow?.id || connId).trim();
      connData = parseConnectionData(connRow?.data);
    }
    if (db && typeof db.all === "function" && connId) {
      rows = db.all(
        // Combo attempt-failure rows (D13) live in usageHistory too: zero
        // tokens, but their timestamp could ANCHOR the 7d window start. Same
        // NULL-safe twin of usageRepo's isFailureUsageStatus gate (open-sse
        // must not import src/lib — duplicated clause by boundary, as in
        // src/lib/comboStats/aggregate.js).
        "SELECT promptTokens, completionTokens, tokens, timestamp, model FROM usageHistory WHERE connectionId = ? AND timestamp >= ? AND (status IS NULL OR status NOT LIKE 'error%')",
        [connId, cutoff7dIso]
      );
    }
  } catch (err) {
    console.warn("[LocalQuotaMeter] DB query error:", err);
  }

  const result = calcSlidingWindowUsage(rows, now, {
    ...psd,
    unit: psd.unit || psd.quotaUnit || "credits",
  });
  return applyAlibabaQuotaExhaustion(
    result,
    {
      lastError: ctx?.lastError ?? connData?.lastError,
      lastErrorAt: ctx?.lastErrorAt ?? connData?.lastErrorAt,
    },
    rows,
    now,
  );
}
