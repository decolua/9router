/**
 * What the Claude Code accounts card says about an account's scheduled
 * keepalive. Pure so it can be tested without rendering the card.
 *
 * The scheduler writes `lastCronPingAt` on success and `lastCronFailedAt` on a
 * failed attempt (it retries inside the catch-up window), so whichever is newer
 * is the account's current state.
 *
 * @param {{lastSentAt?: string|null, lastFailedAt?: string|null}|null|undefined} keepalive
 * @param {{enabled?: boolean, expressions?: string[], timezone?: string|null}|null|undefined} schedule
 * @returns {{tone: "ok"|"failed"|"pending", label: string, at: string|null, timezone: string|null}|null}
 *   null when the account has no active schedule
 */
export function describeKeepalive(keepalive, schedule) {
  const expressions = Array.isArray(schedule?.expressions) ? schedule.expressions.filter(Boolean) : [];
  if (!expressions.length || schedule?.enabled === false) return null;

  const timezone = schedule?.timezone || null;
  const sent = toTime(keepalive?.lastSentAt);
  const failed = toTime(keepalive?.lastFailedAt);

  if (failed !== null && (sent === null || failed > sent)) {
    return { tone: "failed", label: "Last keepalive failed", at: keepalive.lastFailedAt, timezone };
  }
  if (sent !== null) {
    return { tone: "ok", label: "Last keepalive sent", at: keepalive.lastSentAt, timezone };
  }
  return { tone: "pending", label: "No keepalive sent yet", at: null, timezone };
}

/**
 * `09-27 07:03 (Asia/Seoul)`; the zone is named because the server may not
 * share the viewer's, and an unset one means the server's clock (UTC in the
 * container), which is the easiest way for a schedule to run at the wrong hour.
 *
 * @param {string|null} iso
 * @param {string|null} timezone
 * @returns {string}
 */
export function formatKeepaliveTime(iso, timezone) {
  const zoneLabel = timezone || "server time";
  if (!iso) return `(${zoneLabel})`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `(${zoneLabel})`;
  let text;
  try {
    text = new Intl.DateTimeFormat("en-CA", {
      ...(timezone ? { timeZone: timezone } : {}),
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date).replace(",", "");
  } catch {
    text = date.toISOString().slice(5, 16).replace("T", " ");
  }
  return `${text} (${zoneLabel})`;
}

function toTime(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}
