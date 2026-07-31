/**
 * Return a calendar-day key (YYYY-MM-DD) for an instant in an IANA timezone.
 *
 * @param {string} timeZone
 * @param {Date} date
 * @returns {string}
 */
export function dayKeyInTimeZone(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
