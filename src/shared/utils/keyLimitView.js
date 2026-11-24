import { KEY_LIMIT_WINDOW } from "@/shared/constants/keyAccess.js";

/**
 * State of the "Cost limit" switch. It is its own switch, independent of
 * "Restrict access": the only coupling is the priced-only rule, and that can
 * only make the switch unavailable while it is off. It is never left stuck on
 * and disabled: a limit that is saved keeps the switch on and usable (so it can
 * be cleared), and a locally switched-on switch drops back to off if the key
 * stops being able to take a limit (for example Restrict access is turned off).
 * @param {object} key the key with `limit` and `limitStatus`
 * @param {boolean} open switched on in this session, nothing saved yet
 * @returns {{ on: boolean, disabled: boolean }}
 */
export function limitSwitchState(key, open) {
  const limit = key?.limit || null;
  const blocked = keyLimitView(key).disabled && !limit;
  return { on: Boolean(limit) || (Boolean(open) && !blocked), disabled: blocked };
}

// Pure view model for the dashboard "Cost limit" row.
export function keyLimitView(key) {
  const limit = key?.limit || null;
  const s = key?.limitStatus || null;
  if (!s) return { disabled: true, greyed: false, warning: null, note: "Cost limit status unavailable", summary: null };

  if (limit && !s.effective) {
    return {
      disabled: true,
      greyed: true,
      warning: s.unbounded
        ? "Cost limit is disabled because this key is unrestricted and can access unpriced models"
        : `Cost limit is disabled because this key can access unpriced models: ${s.unpriced.join(", ")}`,
      note: null,
      summary: null,
    };
  }
  if (!limit && !s.eligible) {
    return {
      disabled: true,
      greyed: false,
      warning: null,
      note: s.unbounded
        ? "A cost limit needs a restricted key: an unrestricted key can reach unpriced models"
        : `Cost limit unavailable: this key can access unpriced models: ${s.unpriced.join(", ")}`,
      summary: null,
    };
  }
  const when = limit?.window === KEY_LIMIT_WINDOW.MONTH ? "this month" : "today";
  const summary = limit && s.spentUsd !== null
    ? `$${s.spentUsd.toFixed(2)} of $${limit.usd} ${when}, resets ${s.resetsAt}`
    : null;
  return { disabled: false, greyed: false, warning: null, note: null, summary };
}
