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
        ? "Cost limit is disabled because this key can access unpriced models"
        : `Cost limit is disabled because this key can access unpriced models: ${s.unpriced.join(", ")}`,
      note: null,
      summary: null,
    };
  }
  if (!limit && !s.eligible) {
    return {
      ...neutral,
      note: s.unbounded
        ? "This key can access models that have no price, so a limit is saved but not enforced until every model it can reach has a price."
        : `This key can reach unpriced models (${s.unpriced.join(", ")}), so a limit is saved but not enforced until they have a price.`,
    };
  }
  const when = limit?.window === KEY_LIMIT_WINDOW.MONTH ? "this month" : "today";
  const summary = limit && s.spentUsd !== null
    ? `$${s.spentUsd.toFixed(2)} of $${limit.usd} ${when}, resets ${s.resetsAt}`
    : null;
  return { ...neutral, summary };
}

/**
 * Text of the confirmation shown when the "Cost limit" switch is turned on (like the
 * one "Restrict access" shows). Says whether the limit would be enforced right now and,
 * when it would not, why and how to fix it: give the models a price with the "$" chip on
 * the provider's model list.
 * @returns {{ enforced: boolean, lines: string[] }}
 */
export function limitConfirmView(key) {
  const s = key?.limitStatus || null;
  const lines = ["Once the cost limit is reached, this key gets a 429 until the day or month ends (UTC)."];
  if (s && !s.eligible) {
    lines.push(
      s.unbounded
        ? "This key can access models that have no price. The limit is saved but will NOT be applied until every model it can reach has a price."
        : `This key can reach models without a price (${s.unpriced.join(", ")}). The limit is saved but will NOT be applied until they have one.`,
    );
    lines.push('To price a model, open it in the provider\'s model list and click the "$" icon next to its badges: you can set a custom price there.');
    return { enforced: false, lines };
  }
  lines.push("Every model this key can reach has a price, so the limit will be applied.");
  return { enforced: true, lines };
}
