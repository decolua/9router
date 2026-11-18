// Per-API-key quota visibility for /api/quota:
//   * "none"                 — key may not call /api/quota at all (403).
//   * "full"                 — real connection names/emails and quota numbers.
//   * "anonymized-account"   — per-connection rows, identities replaced with
//                              stable one-way labels (conn-<hash>).
//   * "anonymized-aggregate" — same as anonymized-account, plus connections of
//                              the same provider are merged into one aggregate
//                              row per provider whenever every member carries
//                              numeric used/total.
// Shared constants. Used by the apiKeysRepo, the /api/keys routes and the
// Endpoint page, and by /api/quota.

export const QUOTA_ACCESS_NONE = "none";
export const QUOTA_ACCESS_FULL = "full";
export const QUOTA_ACCESS_ACCOUNT = "anonymized-account";
export const QUOTA_ACCESS_AGGREGATE = "anonymized-aggregate";
export const QUOTA_ACCESS_MODES = [
  QUOTA_ACCESS_NONE,
  QUOTA_ACCESS_FULL,
  QUOTA_ACCESS_ACCOUNT,
  QUOTA_ACCESS_AGGREGATE,
];

// Deny-by-default for anything arriving without a known value (legacy rows,
// bad backups, tampered PUT bodies) — a key sees no quota until granted.
export function normalizeQuotaAccess(value) {
  return QUOTA_ACCESS_MODES.includes(value) ? value : QUOTA_ACCESS_NONE;
}

// Stable one-way label for a connection in anonymized mode. Salt makes the
// mapping different per 9router instance so ids can't be cross-indexed.
export function anonymizeConnectionLabel(connection, machineId) {
  if (!connection) return "conn-?";
  const input = `${connection.id || connection.name || "?"}`;
  let h = 0;
  const salted = `${machineId || "9r"}:${input}`;
  for (let i = 0; i < salted.length; i++) {
    h = (h * 31 + salted.charCodeAt(i)) >>> 0;
  }
  return `conn-${h.toString(36)}`;
}
