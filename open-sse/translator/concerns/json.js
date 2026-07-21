// Safe JSON.parse: non-string passthrough; on parse error return caller-chosen `fallback`.
export function safeParseJSON(str, fallback) {
  if (typeof str !== "string") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}
