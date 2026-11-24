// Column names are fixed schema identifiers, never taken from the request.
const fixed = (name, limit, bucket, used, ms) => ({
  name, limit, bucket, used, at: now => Math.floor(now / ms), start: index => index * ms,
});

export const REQUEST_WINDOWS = [
  fixed("minute", "rpmLimit", "rpmMinute", "rpmUsed", 60_000),
  fixed("hour", "hourlyRequestLimit", "requestHour", "hourlyRequests", 3_600_000),
  fixed("day", "dailyRequestLimit", "requestDay", "dailyRequests", 86_400_000),
  {
    name: "month", limit: "monthlyRequestLimit", bucket: "requestMonth", used: "monthlyRequests",
    at(now) { const d = new Date(now); return d.getUTCFullYear() * 12 + d.getUTCMonth(); },
    start(index) { return Date.UTC(Math.floor(index / 12), index % 12, 1); },
  },
];

export function requestLimits(row) {
  return Object.fromEntries(REQUEST_WINDOWS.map(({ limit }) => [limit, row[limit] ?? null]));
}

export function requestQuotaSummary(row, now = Date.now()) {
  return Object.fromEntries(REQUEST_WINDOWS.map(w => {
    const index = w.at(now);
    const used = row[w.bucket] >= index ? row[w.used] : 0;
    const limit = row[w.limit] ?? null;
    return [w.name, { limit, used, remaining: limit === null ? null : Math.max(0, limit - used),
      resetsAt: new Date(w.start(Math.max(index, row[w.bucket]) + 1)).toISOString() }];
  }));
}
