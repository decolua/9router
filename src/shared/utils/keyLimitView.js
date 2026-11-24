import { KEY_LIMIT_WINDOW } from "@/shared/constants/keyAccess.js";

/**
 * State of the "Cost limit" switch. It is its own switch, independent of
 * "Restrict access" and of pricing: it is on when a limit is saved or when it
 * was switched on in this session (nothing saved yet), and nothing about the key
 * ever disables it. Whether a saved limit is ENFORCED is a separate matter, shown
 * by keyLimitView (greyed with a red warning).
 * @param {object} key the key with `limit`
 * @param {boolean} open switched on in this session, nothing saved yet
 * @returns {{ on: boolean }}
 */
export function limitSwitchState(key, open) {
  return { on: Boolean(key?.limit) || Boolean(open) };
}

// Pure view model for the dashboard "Cost limit" row. The fields are always editable;
// the status only decides the look (greyed + red warning when a saved limit is not
// enforced) and a hint (when a limit would not be enforced yet).
export function keyLimitView(key) {
  const limit = key?.limit || null;
  const s = key?.limitStatus || null;
  const neutral = { greyed: false, warning: null, note: null, summary: null };
  if (!s) return neutral;

  if (limit && !s.effective) {
    return {
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
      ...neutral,
      note: s.unbounded
        ? "This key is unrestricted, so a limit is saved but not enforced until the key is restricted and every model it can reach has a price."
        : `This key can reach unpriced models (${s.unpriced.join(", ")}), so a limit is saved but not enforced until they have a price.`,
    };
  }
  const when = limit?.window === KEY_LIMIT_WINDOW.MONTH ? "this month" : "today";
  const summary = limit && s.spentUsd !== null
    ? `$${s.spentUsd.toFixed(2)} of $${limit.usd} ${when}, resets ${s.resetsAt}`
    : null;
  return { ...neutral, summary };
}
