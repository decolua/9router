export function updateProviderStrategy(current, providerId, options) {
  const { strategy, stickyLimit } = options;
  const updated = { ...current };
  const override = { ...(current[providerId] || {}) };

  if (strategy) override.fallbackStrategy = strategy;
  else delete override.fallbackStrategy;

  if (strategy === "round-robin" && stickyLimit !== "") {
    override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
  } else {
    delete override.stickyRoundRobinLimit;
  }

  if (Object.prototype.hasOwnProperty.call(options, "cacheAffinityEnabled")) {
    if (options.cacheAffinityEnabled) override.cacheAffinityEnabled = true;
    else delete override.cacheAffinityEnabled;
  }

  if (Object.keys(override).length === 0) delete updated[providerId];
  else updated[providerId] = override;

  return updated;
}
