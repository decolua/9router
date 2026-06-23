const ALLOWED_PLAN_MONTHS = new Set([1, 3, 6, 12]);
const PLAN_ERROR = "Plan must be one of 1, 3, 6, 12 months";

export function normalizePlanMonths(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(PLAN_ERROR);
  }

  const normalizedValue = typeof value === "string" ? value.trim() : value;
  if (normalizedValue === "") {
    throw new Error(PLAN_ERROR);
  }

  const plan = Number(normalizedValue);
  if (!Number.isInteger(plan) || !ALLOWED_PLAN_MONTHS.has(plan)) {
    throw new Error(PLAN_ERROR);
  }
  return plan;
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addPlanMonths(date, planMonths) {
  const plan = normalizePlanMonths(planMonths);
  const base = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(base.getTime())) throw new Error("Invalid base date");

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const targetMonthIndex = month + plan;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(base.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  ));
}

export function isExpiredAt(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() <= now.getTime();
}

export function getRenewalBaseDate(expiresAt, now = new Date()) {
  if (!expiresAt) return now;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return now;
  return expires.getTime() > now.getTime() ? expires : now;
}

export function calculateExpiresAt(planMonths, baseDate = new Date()) {
  return addPlanMonths(baseDate, planMonths).toISOString();
}
