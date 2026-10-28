// "Tokenmaxxing" combo strategy: order models so the account whose quota is
// closest to expiring unused (most allowance per day left) goes first.
const DAY = 86400000;

// Anchor = the quota window that defines the burn period. Default: the monthly
// quota (/month/i); else the quota with the latest reset (longest window).
export function pickAnchor(quotas) {
  const q = quotas.filter((x) => x.resetAt);
  return q.find((x) => /month/i.test(x.name)) || q.sort((a, b) => new Date(b.resetAt) - new Date(a.resetAt))[0] || null;
}

// Many providers (CodeBuddy, Kiro, ...) report only used/total, not remainingPercentage.
function withPct(q) {
  if (!q || Number.isFinite(q.remainingPercentage)) return q;
  const used = Number(q.used), total = Number(q.total);
  if (!(total > 0) || !Number.isFinite(used)) return q;
  return { ...q, remainingPercentage: Math.max(0, ((total - used) / total) * 100) };
}

// quotas: [{ name, remainingPercentage, resetAt, unlimited }] -> score (higher = route first), null = unknown.
// Any exhausted finite quota (0%) blocks the account -> 0. Else anchor %-left per day until reset.
export function scoreQuotas(quotas, now = Date.now()) {
  const finite = (quotas || []).map(withPct).filter((q) => q && !q.unlimited && Number.isFinite(q.remainingPercentage));
  if (!finite.length) return null;
  if (finite.some((q) => q.remainingPercentage <= 0)) return 0;
  const anchor = pickAnchor(finite);
  if (!anchor) return Math.min(...finite.map((q) => q.remainingPercentage)) / 30;
  const days = Math.max((new Date(anchor.resetAt) - now) / DAY, 1 / 24);
  return Math.min(anchor.remainingPercentage, ...finite.map((q) => q.remainingPercentage)) / days;
}

// Stable sort by score desc; unknown scores keep order after known-positive, exhausted last.
export function orderByScore(models, scores) {
  const rank = (m) => (scores[m] == null ? 0.5 : scores[m] > 0 ? 1 + scores[m] : 0);
  return models.map((m, i) => ({ m, i, r: rank(m) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.m);
}
