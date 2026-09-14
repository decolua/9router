// Federation constants (FED-001). Pure module — no imports, no side effects.
//
// REPLICATE_TABLES: the 8 LOGICAL config tables from docs/federation-spec.md
// §2/§3.3. modelAliases and pricing are NOT physical tables — they live in
// the kv table under scope='modelAliases' / scope='pricing' (see migrate.js
// legacy import + repos/aliasRepo.js + repos/pricingRepo.js). Replication
// code (FED-002+) must map them to kv rows by scope.
export const REPLICATE_TABLES = Object.freeze([
  "settings",
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "modelAliases", // → kv rows with scope='modelAliases'
  "combos",
  "pricing", // → kv rows with scope='pricing'
]);

// The 7 PHYSICAL tables stamped with federation_version/updated_at/deleted by
// migration 002-federation.js. kv carries the modelAliases/pricing logical
// tables; usage tables (usageHistory/usageDaily/requestDetails) stay
// host-local telemetry and are never stamped.
export const REPLICATE_TABLES_PHYSICAL = Object.freeze([
  "settings",
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "kv",
]);

// Edge failover state machine (spec §3.4): LINKED → DEGRADED → RECOVERING → LINKED.
// Values are the wire/persisted forms (e.g. X-Federation-State: degraded).
export const STATES = Object.freeze({
  LINKED: "linked",
  DEGRADED: "degraded",
  RECOVERING: "recovering",
});

export const STATES_LIST = Object.freeze(Object.values(STATES));

// Spec §4 env defaults (shared with config.js).
export const ENV_DEFAULTS = Object.freeze({
  MODE: "standalone",
  SYNC_INTERVAL_MS: 5000,
  HEARTBEAT_INTERVAL_MS: 2000,
  OUTAGE_THRESHOLD_MS: 15000,
  QUEUE_MAX: 10000,
  REPLAY_BATCH_SIZE: 50,
});
