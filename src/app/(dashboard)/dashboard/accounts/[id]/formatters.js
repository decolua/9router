/** Compact USD. Keeps cents below $10 — rounding "$3.61" to "$4" throws away
 *  a meaningful chunk at the scale a new account lives at. */
export function fmtMoney(value) {
  const n = Number(value) || 0;
  if (n === 0) return "$0";
  if (n < 10) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${Math.round(n).toLocaleString()}`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `$${k < 10 ? k.toFixed(2).replace(/\.?0+$/, "") : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `$${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
}

/** Compact token/request counts: 412, 19.6K, 1.67B. */
export function fmtCount(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

/** Coarse duration for countdowns: "3h 12m", "6d 13h", "45m". */
export function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function fmtRelative(timestamp) {
  if (!timestamp) return "never";
  const diff = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(diff)) return "never";
  // A future timestamp is a countdown, not "just now" — token expiry and quota
  // resets both live in the future and read as nonsense otherwise.
  if (diff < 0) return `in ${fmtDuration(-diff)}`;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** "2026-08-13" → "Aug 13" */
export function fmtDayLabel(dateKey) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "2026-08" → "Aug 2026" */
export function fmtMonthLabel(monthKey) {
  if (!monthKey) return "";
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function fmtTimeOfDay(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
