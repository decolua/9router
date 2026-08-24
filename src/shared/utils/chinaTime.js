export const CHINA_TIME_ZONE = "Asia/Shanghai";
export const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

export function getChinaDayStart(timestamp = Date.now()) {
  const value = toTimestamp(timestamp);
  return Math.floor((value + CHINA_UTC_OFFSET_MS) / DAY_MS) * DAY_MS - CHINA_UTC_OFFSET_MS;
}

export function getChinaDateKey(timestamp = Date.now()) {
  const value = toTimestamp(timestamp);
  return new Date(value + CHINA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseChinaDateTime(value) {
  if (value instanceof Date) return new Date(value);
  if (typeof value === "number") return new Date(value);
  const text = String(value || "").trim();
  if (!text) return new Date(Number.NaN);
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) return new Date(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(text)) return new Date(`${text}+08:00`);
  return new Date(text);
}

export function formatChinaTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatChinaDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
