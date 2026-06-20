// Ported from OmniRoute src/shared/constants/routingStrategies.ts.
// Combo + account-fallback strategy enums, the normalize helper, and the UI
// metadata (i18n keys + icons) for each strategy. Pure data — no behavior.

export const ROUTING_STRATEGY_VALUES = [
  "priority",
  "weighted",
  "round-robin",
  "context-relay",
  "fill-first",
  "p2c",
  "random",
  "least-used",
  "cost-optimized",
  "reset-aware",
  "reset-window",
  "strict-random",
  "auto",
  "lkgp",
  "context-optimized",
];

export const AUTO_ROUTING_STRATEGY_VALUES = [
  "rules",
  "cost",
  "eco",
  "latency",
  "fast",
  "sla-aware",
  "sla",
  "lkgp",
];

export const ACCOUNT_FALLBACK_STRATEGY_VALUES = [
  "priority",
  "weighted",
  "fill-first",
  "round-robin",
  "p2c",
  "random",
  "least-used",
  "cost-optimized",
  "strict-random",
];

export const SETTINGS_FALLBACK_STRATEGY_VALUES = ACCOUNT_FALLBACK_STRATEGY_VALUES;

// Normalize an arbitrary input to a valid ROUTING_STRATEGY_VALUES entry.
// Unknown / non-string → "priority" (the safe default).
export function normalizeRoutingStrategy(value) {
  if (typeof value !== "string") return "priority";
  const normalized = value.trim().toLowerCase();
  if (normalized === "usage") return "least-used";
  if (normalized === "context") return "context-optimized";
  if (normalized === "weekly-reset" || normalized === "reset-window-order") return "reset-window";
  return ROUTING_STRATEGY_VALUES.includes(normalized) ? normalized : "priority";
}

export const ROUTING_STRATEGIES = [
  { value: "priority", labelKey: "priority", combosDescKey: "priorityDesc", settingsDescKey: "priorityDesc", icon: "sort" },
  { value: "weighted", labelKey: "weighted", combosDescKey: "weightedDesc", settingsDescKey: "weightedDesc", icon: "percent" },
  { value: "round-robin", labelKey: "roundRobin", combosDescKey: "roundRobinDesc", settingsDescKey: "roundRobinDesc", icon: "autorenew" },
  { value: "context-relay", labelKey: "contextRelay", combosDescKey: "contextRelayDesc", settingsDescKey: "contextRelayDesc", icon: "sync_alt" },
  { value: "fill-first", labelKey: "fillFirst", combosDescKey: "fillFirstDesc", settingsDescKey: "fillFirstDesc", icon: "vertical_align_top" },
  { value: "p2c", labelKey: "p2c", combosDescKey: "p2cDesc", settingsDescKey: "p2cDesc", icon: "balance" },
  { value: "random", labelKey: "random", combosDescKey: "randomDesc", settingsDescKey: "randomDesc", icon: "shuffle" },
  { value: "least-used", labelKey: "leastUsed", combosDescKey: "leastUsedDesc", settingsDescKey: "leastUsedDesc", icon: "low_priority" },
  { value: "cost-optimized", labelKey: "costOpt", combosDescKey: "costOptimizedDesc", settingsDescKey: "costOptDesc", icon: "savings" },
  { value: "reset-aware", labelKey: "resetAware", combosDescKey: "resetAwareDesc", settingsDescKey: "resetAwareDesc", icon: "event_repeat" },
  { value: "reset-window", labelKey: "resetWindow", combosDescKey: "resetWindowDesc", settingsDescKey: "resetWindowDesc", icon: "schedule" },
  { value: "strict-random", labelKey: "strictRandom", combosDescKey: "strictRandomDesc", settingsDescKey: "strictRandomDesc", icon: "casino" },
  { value: "auto", labelKey: "auto", combosDescKey: "autoDesc", settingsDescKey: "autoDesc", icon: "auto_awesome" },
  { value: "lkgp", labelKey: "lkgp", combosDescKey: "lkgpDesc", settingsDescKey: "lkgpDesc", icon: "verified" },
  { value: "context-optimized", labelKey: "contextOpt", combosDescKey: "contextOptimizedDesc", settingsDescKey: "contextOptDesc", icon: "text_snippet" },
];
