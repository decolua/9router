/**
 * Minimal 5-field cron matcher for the quota auto-ping scheduler.
 *
 * The scheduler already ticks once a minute, so the only question a schedule has
 * to answer is "does this expression match the current minute?". That needs no
 * dependency: `*`, `a`, `a-b`, `a-b/n`, `*` /n and comma lists, over
 * `minute hour day-of-month month day-of-week`.
 *
 * Standard cron quirks that are honoured here:
 *  - day-of-week accepts 0-7 with both 0 and 7 meaning Sunday;
 *  - when BOTH day-of-month and day-of-week are restricted, a tick matches if
 *    EITHER field matches (this is what real cron does);
 *  - month/day-of-week also accept three-letter names (jan, mon, ...).
 *
 * Evaluation happens in an optional IANA timezone so "every day at 09:00" means
 * the operator's 09:00, not the server's.
 */

const MINUTE = 0;
const HOUR = 1;
const DAY_OF_MONTH = 2;
const MONTH = 3;
const DAY_OF_WEEK = 4;

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const MACROS = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function namedValue(token, fieldIndex) {
  const key = token.toLowerCase();
  if (fieldIndex === MONTH && key in MONTH_NAMES) return MONTH_NAMES[key];
  if (fieldIndex === DAY_OF_WEEK && key in DAY_NAMES) return DAY_NAMES[key];
  return null;
}

function parseBound(token, fieldIndex) {
  const named = namedValue(token, fieldIndex);
  if (named !== null) return named;
  if (!/^\d+$/.test(token)) return null;
  return Number(token);
}

// Returns a Set of matching values, or null when the field is unparseable.
function parseCronField(spec, fieldIndex) {
  const { min, max } = FIELDS[fieldIndex];
  const values = new Set();

  for (const rawPart of String(spec).split(",")) {
    const part = rawPart.trim();
    if (!part) return null;

    const [rangePart, stepPart, ...extra] = part.split("/");
    if (extra.length) return null;

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }

    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to, ...rest] = rangePart.split("-");
      if (rest.length) return null;
      start = parseBound(from, fieldIndex);
      end = parseBound(to, fieldIndex);
    } else {
      start = parseBound(rangePart, fieldIndex);
      end = stepPart !== undefined ? max : start;
    }

    if (start === null || end === null || Number.isNaN(start) || Number.isNaN(end)) return null;
    if (start < min || end > max || start > end) return null;

    for (let value = start; value <= end; value += step) {
      // 7 is Sunday in cron; normalize so lookups only ever see 0-6.
      values.add(fieldIndex === DAY_OF_WEEK && value === 7 ? 0 : value);
    }
  }

  return values.size ? values : null;
}

/**
 * @returns {{minute:Set<number>,hour:Set<number>,dayOfMonth:Set<number>,month:Set<number>,dayOfWeek:Set<number>,restrictedDayOfMonth:boolean,restrictedDayOfWeek:boolean}|null}
 */
export function parseCronExpression(expression) {
  if (typeof expression !== "string") return null;
  const normalized = expression.trim().toLowerCase();
  if (!normalized) return null;

  const source = MACROS[normalized] || normalized;
  const parts = source.split(/\s+/);
  if (parts.length !== 5) return null;

  const parsed = parts.map((part, index) => parseCronField(part, index));
  if (parsed.some((set) => set === null)) return null;

  return {
    minute: parsed[MINUTE],
    hour: parsed[HOUR],
    dayOfMonth: parsed[DAY_OF_MONTH],
    month: parsed[MONTH],
    dayOfWeek: parsed[DAY_OF_WEEK],
    restrictedDayOfMonth: parts[DAY_OF_MONTH] !== "*",
    restrictedDayOfWeek: parts[DAY_OF_WEEK] !== "*",
  };
}

export function isValidCronExpression(expression) {
  return parseCronExpression(expression) !== null;
}

/**
 * A mistyped zone would otherwise fall back to server-local time, so "daily at
 * 09:00" would fire at the server's 09:00 with nothing to show for it.
 */
export function isValidTimezone(timeZone) {
  if (!timeZone) return true; // empty means "server local", which is explicit
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const PART_FORMATTERS = new Map();

function formatterFor(timeZone) {
  const key = timeZone || "";
  if (!PART_FORMATTERS.has(key)) {
    PART_FORMATTERS.set(key, new Intl.DateTimeFormat("en-US", {
      ...(timeZone ? { timeZone } : {}),
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    }));
  }
  return PART_FORMATTERS.get(key);
}

/**
 * Wall-clock parts of `date` in `timeZone` (server local time when omitted).
 * An invalid timezone falls back to local time rather than throwing — a bad
 * setting must not take the whole scheduler down.
 */
export function zonedParts(date, timeZone) {
  let parts;
  try {
    parts = formatterFor(timeZone).formatToParts(date);
  } catch {
    parts = formatterFor(undefined).formatToParts(date);
  }

  const lookup = {};
  for (const { type, value } of parts) lookup[type] = value;

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // "24" is how some locales spell midnight in hour12:false.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    dayOfWeek: DAY_NAMES[String(lookup.weekday || "").slice(0, 3).toLowerCase()] ?? 0,
  };
}

export function cronMatches(expression, date = new Date(), timeZone = null) {
  const cron = parseCronExpression(expression);
  if (!cron) return false;

  const parts = zonedParts(date, timeZone);
  if (!cron.minute.has(parts.minute)) return false;
  if (!cron.hour.has(parts.hour)) return false;
  if (!cron.month.has(parts.month)) return false;

  const domMatch = cron.dayOfMonth.has(parts.day);
  const dowMatch = cron.dayOfWeek.has(parts.dayOfWeek);
  if (cron.restrictedDayOfMonth && cron.restrictedDayOfWeek) return domMatch || dowMatch;
  if (cron.restrictedDayOfMonth) return domMatch;
  if (cron.restrictedDayOfWeek) return dowMatch;
  return true;
}

/**
 * Stable per-minute identity for a fired schedule. Persisted on the connection
 * so a server restart inside the same minute cannot double-fire.
 */
export function cronFireKey(expression, date = new Date(), timeZone = null) {
  const p = zonedParts(date, timeZone);
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  return `${stamp}|${String(expression).trim().toLowerCase()}`;
}

/** First expression in `expressions` that matches, or null. */
export function firstMatchingExpression(expressions, date = new Date(), timeZone = null) {
  for (const expression of Array.isArray(expressions) ? expressions : []) {
    if (cronMatches(expression, date, timeZone)) return expression;
  }
  return null;
}

const MINUTE_MS = 60000;

/**
 * The most recent scheduled slot at or before `date`, looking back at most
 * `windowMinutes` whole minutes — or null when none fell inside that window.
 *
 * `firstMatchingExpression` only answers "is this exact minute a slot?", so a
 * slot is lost whenever the one tick that should see it does not: a tick still
 * busy, an earlier connection's ping running past the minute, a restart across
 * it. This lets the caller fire a slot late instead of never. `at` is the
 * slot's own minute, so a fire key built from it is the same however late the
 * slot is fired — which is what stops it firing twice.
 *
 * @param {string[]} expressions
 * @param {Date} date
 * @param {string|null} timeZone
 * @param {number} windowMinutes  0 = the current minute only
 * @returns {{expression: string, at: Date}|null}
 */
export function latestDueFire(expressions, date = new Date(), timeZone = null, windowMinutes = 0) {
  const currentMinute = Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS;
  const lookBack = Math.max(0, Math.floor(windowMinutes));
  for (let back = 0; back <= lookBack; back += 1) {
    const at = new Date(currentMinute - back * MINUTE_MS);
    const expression = firstMatchingExpression(expressions, at, timeZone);
    if (expression) return { expression, at };
  }
  return null;
}
