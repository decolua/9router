// Shared subscription-price maths.
//
// Both the quota-card badge and the account detail page answer "what did this
// sub cost me", so the calculation lives here rather than in each route — two
// copies drifted once already, and the badge disagreed with the page after a
// plan change.

const MS_PER_DAY = 86400000;

/**
 * Number of calendar months the sub has been held, floored at 1.
 *
 * Counted from the same month list that `lifetimePaidFor` charges, so the
 * figure shown ("$20/mo x 2 months") always matches the amount billed. An
 * elapsed-days count disagreed with it across a month boundary: a sub created
 * on 31 July and viewed on 19 August reported one month but charged two.
 */
export function monthsSince(createdAt) {
  return monthKeysSince(createdAt).length;
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
  // A null amount is a deliberate "price cleared" entry, not junk — dropping
  // it would leave later months charged at the price that was just removed.
  const sorted = Array.isArray(history)
    ? [...history]
        .filter((h) => h
          && typeof h.effectiveFrom === "string"
          && (typeof h.amount === "number" || h.amount === null))
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
