"use client";

import PropTypes from "prop-types";
import Tooltip from "@/shared/components/Tooltip";

/**
 * Compact USD formatting: $3.61, $412, $1.2k, $10k, $1.4M.
 * Values under $10 keep cents — rounding "$3.61" to "$4" throws away a
 * meaningful chunk of the number at the scale where a new account lives.
 */
function fmtMoney(value) {
  const n = Number(value) || 0;
  if (n === 0) return "$0";
  if (n < 10) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${Math.round(n)}`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `$${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `$${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
}

/**
 * "How much API value did this subscription actually deliver."
 *
 * Value = this account's real traffic priced at API list rates. Paid = the
 * user-confirmed monthly price, multiplied by months held when showing
 * lifetime (a lifetime total compared against one month's price would
 * overstate the ratio by however long the sub has been active).
 */
export default function SubscriptionValueBadge({ value, window: windowMode, onToggleWindow }) {
  if (!value) return null;

  const isLifetime = windowMode === "lifetime";
  const apiValue = isLifetime ? value.lifetimeCost : value.monthCost;
  const requests = isLifetime ? value.lifetimeRequests : value.monthRequests;

  // Nothing routed through this account yet — a "$0 for 20 bucks" badge is
  // just noise on a freshly connected sub.
  if (!apiValue && !requests) return null;

  const paid = isLifetime ? value.lifetimePaid : value.monthlyCost;
  const hasPrice = typeof paid === "number";
  const isFree = hasPrice && paid === 0;

  let label;
  if (!hasPrice) {
    label = `${fmtMoney(apiValue)} of API value`;
  } else if (isFree) {
    label = `${fmtMoney(apiValue)} for free`;
  } else {
    label = `${fmtMoney(apiValue)} for ${fmtMoney(paid)}`;
  }

  const multiple = hasPrice && paid > 0 ? apiValue / paid : null;

  const windowText = isLifetime
    ? `lifetime${value.months > 1 ? ` (${value.months} months)` : ""}`
    : "this month";

  const tooltip = [
    `${fmtMoney(apiValue)} of usage at API list prices, ${windowText}.`,
    hasPrice
      ? isFree
        ? "This sub costs nothing."
        : `You paid ${fmtMoney(paid)}${isLifetime && value.months > 1 ? ` (${fmtMoney(value.monthlyCost)}/mo × ${value.months})` : ""}.`
      : "Set a monthly price in this connection's edit form to see the ratio.",
    multiple != null ? `That's ${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}x what you paid.` : null,
    `Click to switch to ${isLifetime ? "this month" : "lifetime"}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip text={tooltip}>
      <button
        type="button"
        onClick={onToggleWindow}
        aria-label={`${label}, ${windowText}. Click to switch window.`}
        className="shrink-0 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-85"
      >
        {label}
      </button>
    </Tooltip>
  );
}

SubscriptionValueBadge.propTypes = {
  value: PropTypes.shape({
    lifetimeCost: PropTypes.number,
    monthCost: PropTypes.number,
    lifetimeRequests: PropTypes.number,
    monthRequests: PropTypes.number,
    monthlyCost: PropTypes.number,
    months: PropTypes.number,
    lifetimePaid: PropTypes.number,
  }),
  window: PropTypes.oneOf(["lifetime", "month"]).isRequired,
  onToggleWindow: PropTypes.func.isRequired,
};
