// Pure helpers for the model-row price chip and price card.
import { PRICING_SOURCE } from "open-sse/config/pricingSources.js";

const SOURCE_LABEL = {
  [PRICING_SOURCE.OVERRIDE]: "your override",
  [PRICING_SOURCE.PROVIDER]: "built-in provider price",
  [PRICING_SOURCE.MODEL]: "built-in price",
  [PRICING_SOURCE.PATTERN]: "wildcard price",
  [PRICING_SOURCE.FREE]: "free",
};

/** @param {{pricing: object|null, source: string}|undefined} price */
export function priceChipView(price) {
  if (!price) return null;
  if (!price.pricing || price.source === PRICING_SOURCE.NONE) {
    return { label: "$ ?", tone: "warn", tooltip: "No price: cost is recorded as $0 and a spend limit cannot cover this model. Click to set one." };
  }
  const { input, output } = price.pricing;
  const tone = price.source === PRICING_SOURCE.OVERRIDE ? "primary" : "muted";
  return {
    label: "$",
    tone,
    tooltip: `$${input} in / $${output} out per 1M tokens (${SOURCE_LABEL[price.source] || price.source})`,
  };
}

const FIELDS = ["input", "output", "cached", "reasoning", "cache_creation"];

/** Form strings -> numbers. input and output are required; the rest are optional. */
export function validatePriceForm(form) {
  const value = {};
  for (const f of FIELDS) {
    const raw = String(form?.[f] ?? "").trim();
    if (raw === "") {
      if (f === "input" || f === "output") return { ok: false, error: `${f} price is required` };
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${f} must be a number, zero or more` };
    value[f] = n;
  }
  return { ok: true, value };
}
