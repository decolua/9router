import { REQUEST_WINDOWS as windows } from "../../../shared/utils/requestWindows.js";

export const requestWindowColumns = windows.flatMap(w => [w.limit, w.bucket, w.used]).join(",");

// Both ordinary key admission and budget reservation use the same UTC periods.
export const periodsSql = `(SELECT ${windows.map(w => `? AS ${w.name}Id`).join(", ")}) AS period`;
export const periodIds = now => windows.map(w => w.at(now));
export const withinWindows = windows.map(w => `(${w.limit} IS NULL OR ${w.bucket}<period.${w.name}Id OR
    (${w.bucket}=period.${w.name}Id AND ${w.used}<${w.limit}))`).join(" AND ");
export const incrementWindows = windows.map(w => `
  ${w.used} = CASE WHEN ${w.limit} IS NULL THEN ${w.used} WHEN ${w.bucket}=period.${w.name}Id THEN ${w.used}+1 ELSE 1 END,
  ${w.bucket} = CASE WHEN ${w.limit} IS NULL THEN ${w.bucket} ELSE period.${w.name}Id END`).join(", ");

export function blockedWindows(row, now) {
  const blocked = windows.filter(w => row[w.limit] != null &&
    (row[w.bucket] > w.at(now) || (row[w.bucket] === w.at(now) && row[w.used] >= row[w.limit])));
  if (!blocked.length) return null;
  const retryAt = Math.max(...blocked.map(w => w.start(row[w.bucket] + Number(row[w.used] >= row[w.limit]))));
  return { status: 429, windows: blocked.map(w => w.name), retryAfter: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
}
