// Where an effective model price comes from. Returned by resolvePricing()
// (providers/pricing.js) and pricingRepo.resolvePricingForModel(); shown by the
// dashboard price chip. Use these constants, never the bare strings.
export const PRICING_SOURCE = Object.freeze({
  OVERRIDE: "override", // a price saved by the user from the dashboard
  PROVIDER: "provider", // PROVIDER_PRICING[provider][model]
  FREE: "free", // a free namespace, upstream bills $0
  MODEL: "model", // MODEL_PRICING[model], provider-agnostic
  PATTERN: "pattern", // PATTERN_PRICING glob match (a wildcard price)
  NONE: "none", // no price: cost is recorded as $0
});
