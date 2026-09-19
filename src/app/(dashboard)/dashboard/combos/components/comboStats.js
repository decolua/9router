/**
 * CB4 — pure display model for combo success stats.
 *
 * React-free on purpose: every decision the UI makes (which number, which
 * order, "—" vs a real rate, "parcial", fetch fail-open) lives here so it is
 * unit-testable in the node environment (same precedent as f24d-badge, which
 * tests the pure helpers of useCircuitBreakers rather than rendered JSX).
 * The React components under this folder are thin passthroughs over these
 * functions — if a value is not produced here, it does not reach the screen.
 *
 * Single source of truth: the ONLY number any combo chip/column shows is the
 * one GET /api/usage/combo-stats already returns. We never recompute success
 * from another endpoint (e.g. usage/stats.byModel) and never invent a number
 * when the source has none — a null rate renders as "—", never 0%/100%.
 */

/** Accepted `?range=` values → window length. `24h` is the route default. */
export const RANGES = ["1h", "24h", "7d", "30d"];

/**
 * UsageStats period selector → combo-stats range. `today` has no dedicated
 * window upstream, so it maps to the 24h default; `60d` clamps to the widest
 * supported window (30d) rather than erroring the request.
 */
export const RANGE_BY_PERIOD = {
  today: "24h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "60d": "30d",
};

export function mapPeriodToRange(period) {
  return RANGE_BY_PERIOD[period] || "24h";
}

/**
 * Fraction (0..1) → display string with at most one decimal, or "—" when the
 * source gave no denominator. 0.625 → "62.5%"; null/NaN → "—". Rounding to one
 * decimal (not integer) is what keeps 5/8 honest as "62.5%" instead of "63%".
 */
export function formatPct(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

/** The compact chip text for one combo: its server-side successRate, or "—". */
export function chipLabel(entry) {
  if (!entry) return "—";
  return formatPct(entry.successRate);
}

/**
 * Discreet chip tone. Colors reflect a REAL rate only; an absent rate stays
 * neutral grey so a fetch gap or a fresh combo never looks like a red error.
 * (The "no red on fetch failure" rule lives here, not in a toast.)
 */
export function chipTone(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return "border-border bg-surface text-text-muted";
  }
  if (rate >= 0.9) return "border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
  if (rate >= 0.7) return "border-amber-500/20 bg-amber-500/10 text-amber-500";
  return "border-red-500/20 bg-red-500/10 text-red-500";
}

/**
 * Coverage honesty (CB5/NIT-1): the endpoint flags the payload "partial" only
 * when the window still contains winning rows that PREDATE the attribution
 * epoch (the first record in the DB carrying a meta.combo) — genuine
 * pre-attribution history, not today's legitimate direct traffic. The rate
 * then covers attributed traffic only and may be understated. We surface
 * "parcial" per combo card in that case — never a silently-dropped caveat.
 */
export function coverageBadgeLabel(payload) {
  if (payload && payload.coverage === "partial") return "parcial";
  return null;
}

/**
 * CB5/NIT-2: a combo may list ANOTHER COMBO as a member; traffic routed
 * through it is attributed to the inner combo (CB2 nesting rule), so the
 * outer card's counts are a strict floor, not the whole truth. The aggregate
 * flags the sub-combo NAMES on the entry (sources.nestedCombos); we render
 * them as one plain pt-BR line inside the expansion — text only, zero new
 * numbers, and no invented figure for the shadowed traffic.
 * (Cards whose outer combo has NO attributed entry at all cannot show this
 * yet: the badge only receives `entry`/`coverage` — surfacing the notice on
 * an entry-less card needs one prop pass in combos/page.js, out of CB5 scope.)
 */
export function subComboNoticeLines(entry) {
  const subs = Array.isArray(entry?.nestedSubCombos) ? entry.nestedSubCombos : [];
  return subs
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => `inclui sub-combo: ${name} — contagem aparece no cartão de ${name}`);
}

/** Match a combo card to its entry in a fetched payload (by declared name). */
export function pickComboEntry(payload, comboName) {
  if (!payload || !Array.isArray(payload.combos)) return null;
  const hit = payload.combos.find((c) => c && c.combo === comboName);
  return hit || null;
}

/**
 * Members sorted worst-first by failureRate (the problematic ones on top), so
 * a triaging glance lands on the failing member immediately. A member with an
 * unknown rate (attempts 0) sorts to the bottom, never impersonating a
 * failure. Stable tie-break on member name keeps renders deterministic.
 */
export function sortMembersByFailure(members) {
  const arr = Array.isArray(members) ? members.slice() : [];
  const rateOf = (m) => (Number.isFinite(m?.failureRate) ? m.failureRate : -1);
  return arr.sort((a, b) => {
    const d = rateOf(b) - rateOf(a);
    if (Math.abs(d) > 1e-9) return d;
    return String(a?.member ?? "").localeCompare(String(b?.member ?? ""));
  });
}

/**
 * Relative "há X" from an ISO timestamp, pt-BR style (3h, 45min, 2d). Returns
 * null when there is no timestamp — the badge then omits the error line rather
 * than printing a bogus age. `now` is injectable for tests.
 */
export function relativeErrorText(lastErrorAt, now = Date.now()) {
  if (!lastErrorAt) return null;
  const t = new Date(lastErrorAt).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, Math.floor((now - t) / 1000));
  if (diff < 60) return "há <1min";
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86400)}d`;
}

/** Live circuit-breaker dot palette (reuses the health-badge status colors). */
export const BREAKER_COLOR = {
  OPEN: "#ef4444",
  HALF_OPEN: "#f59e0b",
  DEGRADED: "#f59e0b",
  CLOSED: "#22c55e",
};

export function breakerDotColor(breaker) {
  if (!breaker || !breaker.state) return "#6b7280"; // unknown = grey, never red
  return BREAKER_COLOR[breaker.state] || "#6b7280";
}

export function breakerDotLabel(breaker) {
  if (!breaker || !breaker.state) return "no live breaker";
  const secs = breaker.retryAfterMs > 0 ? ` (${Math.ceil(breaker.retryAfterMs / 1000)}s)` : "";
  return `breaker ${breaker.state}${secs}`;
}

/**
 * Everything one expanded member row shows, resolved from the source numbers.
 * Kept as a pure view-model so the badge maps over it without arithmetic and a
 * test can assert the exact strings ("5/8", "62.5%", "error:503 · há 3 h").
 */
export function memberRowView(member, now = Date.now()) {
  const attempts = Number.isFinite(member?.attempts) ? member.attempts : null;
  const failures = Number.isFinite(member?.failures) ? member.failures : null;
  const hasError = Boolean(member?.lastErrorStatus);
  const when = relativeErrorText(member?.lastErrorAt, now);
  return {
    member: member?.member ?? null,
    provider: member?.provider ?? null,
    model: member?.model ?? null,
    label: member?.member || member?.model || member?.provider || "—",
    attempts,
    failRatio: attempts === null ? "—" : `${failures ?? 0}/${attempts}`,
    failPct: formatPct(member?.failureRate),
    errorText: hasError ? `${member.lastErrorStatus}${when ? ` · ${when}` : ""}` : "—",
    breakerColor: breakerDotColor(member?.breaker),
    breakerLabel: breakerDotLabel(member?.breaker),
  };
}

/**
 * combo name → server successRate, for the Usage-by-Combo "Success %" column.
 * Reads the SAME endpoint; the value is whatever the aggregate computed (null
 * included), never a client-side re-derivation from tokens/requests.
 */
export function buildComboSuccessMap(payload) {
  const map = {};
  if (payload && Array.isArray(payload.combos)) {
    for (const c of payload.combos) {
      if (c && typeof c.combo === "string") map[c.combo] = c.successRate ?? null;
    }
  }
  return map;
}

/**
 * Fetch + normalize combo-stats, FAIL-OPEN (the F12 pattern): a rejected
 * network call or a non-2xx response resolves to { data: null, error: true }
 * instead of throwing, so the chip degrades to "—" and nothing surfaces a red
 * toast. `fetchImpl` is injectable for tests; defaults to globalThis.fetch
 * (same-origin cookies ride along — deny-by-default covers the gate).
 */
export async function loadComboStats(range = "24h", fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/api/usage/combo-stats?range=${encodeURIComponent(range)}`, {
      cache: "no-store",
    });
    if (!res || !res.ok) return { data: null, error: true };
    const json = await res.json();
    if (!json || !Array.isArray(json.combos)) return { data: json || null, error: false };
    return { data: json, error: false };
  } catch {
    return { data: null, error: true };
  }
}
