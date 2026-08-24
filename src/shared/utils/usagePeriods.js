export const USAGE_PERIODS = [
  { value: "today", label: "今天" },
  { value: "24h", label: "最近 24 小时" },
  { value: "7d", label: "1 周" },
  { value: "30d", label: "1 个月" },
  { value: "custom", label: "自定义" },
];

export const USAGE_DEFAULT_PERIODS = USAGE_PERIODS.filter(({ value }) => value !== "custom");

export function normalizeUsagePeriod(period) {
  return USAGE_DEFAULT_PERIODS.some(({ value }) => value === period) ? period : "today";
}

export function toLocalDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getPeriodRange(period, now = new Date(), todayEndsTomorrow = false) {
  const end = new Date(now);
  let start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
    if (todayEndsTomorrow) {
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1);
    }
  } else if (period === "24h") {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === "7d") {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === "30d") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return { startDate: toLocalDateTimeValue(start), endDate: toLocalDateTimeValue(end) };
}
