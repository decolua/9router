"use client";

import PropTypes from "prop-types";
import Tooltip from "./Tooltip";
import { priceChipView } from "@/shared/utils/priceChipView.js";

const TONE = { warn: "text-orange-500", primary: "text-primary", muted: "text-text-muted/70" };

// Small "$" next to a model's capability badges; click opens the price card.
export default function PriceChip({ price, onClick, size = 12 }) {
  const view = priceChipView(price);
  if (!view) return null;
  return (
    <Tooltip text={view.tooltip}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center rounded px-0.5 font-mono font-semibold leading-none hover:bg-sidebar ${TONE[view.tone]}`}
        style={{ fontSize: `${size}px` }}
        aria-label={view.tooltip}
      >
        {view.label}
      </button>
    </Tooltip>
  );
}

PriceChip.propTypes = {
  price: PropTypes.shape({ pricing: PropTypes.object, source: PropTypes.string }),
  onClick: PropTypes.func.isRequired,
  size: PropTypes.number,
};
