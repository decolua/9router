// Ported from OmniRoute open-sse/services/autoCombo/modePacks.ts.
// Pre-defined weight profiles for Auto-Combo scoring. Pure data.

export const MODE_PACKS = {
  // Prioritize latency → health.
  "ship-fast": {
    quota: 0.14, health: 0.28, costInv: 0.05, latencyInv: 0.32, taskFit: 0.1,
    stability: 0.0, tierPriority: 0.05, tierAffinity: 0, specificityMatch: 0,
    contextAffinity: 0.01, resetWindowAffinity: 0, connectionDensity: 0.05,
  },
  // Prioritize cost.
  "cost-saver": {
    quota: 0.14, health: 0.19, costInv: 0.37, latencyInv: 0.05, taskFit: 0.1,
    stability: 0.05, tierPriority: 0.05, tierAffinity: 0, specificityMatch: 0,
    contextAffinity: 0.0, resetWindowAffinity: 0, connectionDensity: 0.05,
  },
  // Prioritize task fitness.
  "quality-first": {
    quota: 0.1, health: 0.18, costInv: 0.05, latencyInv: 0.05, taskFit: 0.37,
    stability: 0.15, tierPriority: 0.05, tierAffinity: 0, specificityMatch: 0,
    contextAffinity: 0.0, resetWindowAffinity: 0, connectionDensity: 0.05,
  },
  // Prioritize quota availability.
  "offline-friendly": {
    quota: 0.37, health: 0.28, costInv: 0.1, latencyInv: 0.05, taskFit: 0.0,
    stability: 0.1, tierPriority: 0.05, tierAffinity: 0, specificityMatch: 0,
    contextAffinity: 0.0, resetWindowAffinity: 0, connectionDensity: 0.05,
  },
  // #4235 `:reliable` — prioritize healthy, low-variance providers.
  "reliability-first": {
    quota: 0.14, health: 0.37, costInv: 0.04, latencyInv: 0.05, taskFit: 0.1,
    stability: 0.2, tierPriority: 0.05, tierAffinity: 0, specificityMatch: 0,
    contextAffinity: 0.0, resetWindowAffinity: 0, connectionDensity: 0.05,
  },
};

/** Get a mode pack by name (undefined if unknown). */
export function getModePack(name) {
  return MODE_PACKS[name];
}

/** Get all available mode pack names. */
export function getModePackNames() {
  return Object.keys(MODE_PACKS);
}
