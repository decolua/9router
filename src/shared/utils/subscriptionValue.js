// Shared subscription-price maths.
//
// Both the quota-card badge and the account detail page answer "what did this
// sub cost me", so the calculation lives here rather than in each route — two
// copies drifted once already, and the badge disagreed with the page after a
// plan change.

const MS_PER_DAY = 86400000;

/**
 * Whole months elapsed since a connection was created, floored at 1.
 *
 * A sub billed monthly has been paid for at least once the moment it exists,
 * so a 3-day-old account is "1 month paid", not 0.1 — the alternative divides
 * by a fraction and reports an absurdly inflated multiple in week one.
 */
export function monthsSince(createdAt) {
  if (!createdAt) return 1;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return 1;
  const days = (Date.now() - start.getTime()) / MS_PER_DAY;
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.max(1, Math.floor(days / 30.44) + 1);
}

export function daysSince(createdAt) {
  if (!createdAt) return 1;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return 1;
  return Math.max(1, Math.round((Date.now() - start.getTime()) / MS_PER_DAY));
}

/** Every month key ("2026-08") from the connection's creation through today. */
export function monthKeysSince(createdAt) {
  const now = new Date();
  const start = createdAt ? new Date(createdAt) : now;
  const from = Number.isNaN(start.getTime()) ? now : start;

  const keys = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  // Guard against a bogus future createdAt producing an empty span.
  if (cursor > end) return [`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}`];

  while (cursor <= end) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

/**
 * Price in force during a given month ("2026-08"), from the recorded change
 * log. Months before the first recorded change are marked `assumed`, because
 * the price then is genuinely unknown — the log only starts when the user
 * first sets a price, and pretending otherwise is what made month-by-month
 * numbers wrong after a plan change.
 */
export function priceForMonth(monthKey, history, currentCost) {
  const sorted = Array.isArray(history)
    ? [...history]
        .filter((h) => h && typeof h.effectiveFrom === "string" && typeof h.amount === "number")
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    : [];

  if (sorted.length === 0) return { amount: currentCost, assumed: currentCost != null };

  // Compare at the month's end, so a price set mid-month applies to that month.
  const monthEnd = `${monthKey}-31`;
  let applicable = null;
  for (const entry of sorted) {
    if (entry.effectiveFrom.slice(0, 10) <= monthEnd) applicable = entry;
    else break;
  }

  // Earlier than any recorded price — fall back to the oldest known one.
  if (!applicable) return { amount: sorted[0].amount, assumed: true };
  return { amount: applicable.amount, assumed: false };
}

/**
 * Total paid across every month the sub was *held*, not just the months it was
 * used — idle months are still billed, and counting only active ones
 * understates the cost and inflates the return.
 *
 * @returns {number|null} null when no price is known for any month.
 */
export function lifetimePaidFor(createdAt, history, currentCost) {
  const amounts = monthKeysSince(createdAt)
    .map((mk) => priceForMonth(mk, history, currentCost).amount)
    .filter((amount) => typeof amount === "number");
  return amounts.length === 0 ? null : amounts.reduce((sum, a) => sum + a, 0);
}
