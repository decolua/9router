/**
 * Shared Usage & Analytics period definitions (UI + API validation + aggregation).
 */

export const USAGE_PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "90d", label: "90D" },
  { value: "180d", label: "180D" },
  { value: "365d", label: "365D" },
  { value: "all", label: "All" },
];

/** @type {Set<string>} */
export const VALID_USAGE_STATS_PERIODS = new Set(USAGE_PERIOD_OPTIONS.map((o) => o.value));

/** Chart supports the same day-based periods as stats (including all-time). */
export const VALID_USAGE_CHART_PERIODS = VALID_USAGE_STATS_PERIODS;

/** Calendar-day lookback for daily rollup queries; `all` → null (no date filter). */
export const USAGE_PERIOD_DAYS = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "180d": 180,
  "365d": 365,
  all: null,
};

/**
 * @param {string} period
 * @returns {number | null}
 */
export function getUsagePeriodDays(period) {
  if (period === "today" || period === "24h") return null;
  if (period === "all") return null;
  return Object.prototype.hasOwnProperty.call(USAGE_PERIOD_DAYS, period)
    ? USAGE_PERIOD_DAYS[period]
    : null;
}

/**
 * Fixed bucket count for chart (daily bars). Returns null for `all` (variable length).
 * @param {string} period
 * @returns {number | null}
 */
export function getChartDayBucketCount(period) {
  const days = getUsagePeriodDays(period);
  return days;
}