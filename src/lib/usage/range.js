const HOUR = 3600_000;
const DAY = 24 * HOUR;
const periods = new Map([["1h", HOUR], ["24h", DAY], ["7d", 7 * DAY], ["30d", 30 * DAY],
  ["60d", 60 * DAY], ["90d", 90 * DAY]]);

export class UsageInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function instant(value) {
  // Bare dates are UTC midnight; a clock time requires an explicit UTC offset.
  const parts = /^(\d{4}-\d\d-\d\d)(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(value);
  const day = parts && new Date(parts[1]);
  const ms = Date.parse(value);
  if (!day || !Number.isFinite(+day) || !day.toISOString().startsWith(parts[1]) || !Number.isFinite(ms))
    throw new UsageInputError("Expected a valid ISO date or timestamp with timezone");
  return ms;
}

// Half-open UTC windows: consecutive exports never duplicate a boundary row.
export function parseUsageRange(params, now = Date.now()) {
  for (const key of ["period", "from", "to"])
    if (params.getAll(key).length > 1) throw new UsageInputError("Duplicate time filter");
  let from, to = now;
  const period = params.get("period");
  if (params.has("from") || params.has("to")) {
    if (period !== null || !params.has("from") || !params.has("to"))
      throw new UsageInputError("Use period or both from and to");
    from = instant(params.get("from")); to = instant(params.get("to"));
    const limit = new Date(from);
    limit.setUTCFullYear(limit.getUTCFullYear() + 2);
    if (limit.getUTCDate() !== new Date(from).getUTCDate()) limit.setUTCDate(0);
    if (to <= from || to > +limit) throw new UsageInputError("Expected a positive range of at most two years");
  } else if (period === "all") {
    return { from: null, to: null, bucketSeconds: 86400 };
  } else if (period === "today") {
    from = now - now % DAY;
  } else {
    const span = periods.get(period ?? "7d");
    if (!span) throw new UsageInputError("Invalid period");
    from = now - span;
  }
  const span = to - from;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    bucketSeconds: span <= HOUR ? 300 : span <= DAY ? 3600 : 86400 };
}
