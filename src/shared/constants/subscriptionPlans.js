/**
 * Subscription plan price catalog.
 *
 * Used ONLY to seed the "Sub cost / month" field in the connection edit form —
 * never as a silent default. A connection without an explicit `monthlyCost`
 * renders its API value without a ratio, because guessing the denominator
 * would make the badge quietly lie (annual billing, regional pricing, team
 * seats, and grandfathered rates all diverge from list price).
 *
 * Prices are USD/month at list rate, as of 2026-08.
 */
export const SUBSCRIPTION_PLANS = {
  claude: {
    free: 0,
    pro: 20,
    max: 100,
    "max 5x": 100,
    "max 20x": 200,
    team: 30,
    enterprise: null,
  },
  codex: {
    free: 0,
    plus: 20,
    pro: 200,
    business: 30,
    team: 30,
    enterprise: null,
  },
  gh: {
    free: 0,
    individual: 10,
    pro: 10,
    "pro+": 39,
    business: 19,
    enterprise: 39,
  },
  github: {
    free: 0,
    individual: 10,
    pro: 10,
    "pro+": 39,
    business: 19,
    enterprise: 39,
  },
  "opencode-go": {
    free: 0,
    go: 20,
  },
  "grok-cli": {
    free: 0,
    supergrok: 30,
    "supergrok heavy": 300,
  },
  kimi: {
    free: 0,
  },
  google: {
    free: 0,
    "ai pro": 20,
    "ai ultra": 250,
  },
  kiro: {
    free: 0,
    pro: 19,
    "pro+": 39,
    power: 200,
  },
};

/**
 * Look up a suggested monthly price for a connection.
 * Returns null when we can't confidently guess — the caller must then leave
 * the field empty rather than inventing a number.
 *
 * @param {string} provider - connection provider id
 * @param {string} plan - plan/tier string as reported by the provider
 * @returns {number|null} USD per month, or null if unknown
 */
export function getSuggestedMonthlyCost(provider, plan) {
  if (!provider || !plan) return null;
  const providerPlans = SUBSCRIPTION_PLANS[String(provider).toLowerCase()];
  if (!providerPlans) return null;

  const key = String(plan).toLowerCase().trim();
  if (key === "unknown" || key === "") return null;

  if (Object.hasOwn(providerPlans, key)) {
    const price = providerPlans[key];
    return typeof price === "number" ? price : null;
  }

  // Providers report tiers inconsistently ("Max 20x", "max_20x", "ChatGPT Pro").
  // Match on a normalized form before giving up.
  // "+" is spelled both ways in the wild ("Pro+", "Pro Plus"), so fold it on
  // both sides — otherwise "pro plus" never matches the "pro+" key and falls
  // through to plain "pro" at half the price.
  const normalize = (value) => value
    .replace(/\+/g, " plus")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = normalize(key);
  // Longest key first: "pro plus" contains "pro", and insertion order would
  // otherwise return the Pro price for a Pro+ plan.
  const candidates = Object.entries(providerPlans)
    .filter(([, price]) => typeof price === "number")
    .map(([planKey, price]) => [normalize(planKey), price])
    .sort((a, b) => b[0].length - a[0].length);

  for (const [planKey, price] of candidates) {
    if (planKey === normalized) return price;
  }
  for (const [planKey, price] of candidates) {
    if (normalized.includes(planKey)) return price;
  }

  return null;
}
