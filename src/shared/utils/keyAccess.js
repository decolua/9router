// Per-API-key access control: pure helpers (no DB, no
// request objects), shared by the DB repo, the API routes and the engine.
import {
  KEY_ACCESS_MAX_ENTRIES,
  KEY_ACCESS_MAX_ENTRY_LENGTH,
  KEY_ACCESS_UNRESTRICTED,
} from "@/shared/constants/keyAccess.js";

/**
 * Normalize an allow list: keep strings only, trim, drop empties, de-duplicate
 * case-insensitively (the first spelling wins). Order is preserved.
 */
export function normalizeAllowList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const entry = item.trim();
    if (!entry) continue;
    const k = entry.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(entry);
  }
  return out;
}

/**
 * Build independent model/account policies from apiKeys columns.
 *
 * Fails CLOSED: the restricted flag has its own INTEGER column, so a corrupt or
 * unparsable allow list can only ever shrink what a restricted key may call
 * (to nothing); it can never turn a restricted key into an unrestricted one.
 */
export function keyAccessFromColumns(restrictedCol, allowCol, accountsRestrictedCol, accountIdsCol) {
  const restricted = restrictedCol === 1 || restrictedCol === true;
  let parsed = [];
  if (restricted && typeof allowCol === "string" && allowCol) {
    try { parsed = JSON.parse(allowCol); } catch { parsed = []; }
  }
  const accountsRestricted = accountsRestrictedCol === 1 || accountsRestrictedCol === true;
  let accountIds = [];
  if (accountsRestricted && typeof accountIdsCol === "string" && accountIdsCol) {
    try { accountIds = JSON.parse(accountIdsCol); } catch { accountIds = []; }
  }
  return { restricted, allow: normalizeAllowList(parsed), accountsRestricted, accountIds: normalizeAccountIds(accountIds) };
}

// Connection IDs are opaque and case-sensitive, unlike model names.
export function normalizeAccountIds(list) {
  return Array.isArray(list) ? [...new Set(list.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean))] : [];
}

/** Columns to persist for an access object (already validated/normalized). */
export function keyAccessToColumns(access) {
  const value = access || KEY_ACCESS_UNRESTRICTED;
  return {
    accessRestricted: value.restricted ? 1 : 0,
    accessAllow: JSON.stringify(value.restricted ? normalizeAllowList(value.allow) : []),
    accessAccountsRestricted: value.accountsRestricted ? 1 : 0,
    accessAccountIds: JSON.stringify(value.accountsRestricted ? normalizeAccountIds(value.accountIds) : []),
  };
}

/**
 * Validate client input for independent model/account policies.
 * Rejects rather than repairs: wrong types, too many entries, overlong entries.
 * Missing account fields retain legacy unrestricted behavior.
 */
export function validateKeyAccessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "access must be an object { restricted, allow }" };
  }
  const extra = Object.keys(input).filter((k) => !["restricted", "allow", "accountsRestricted", "accountIds"].includes(k));
  if (extra.length) return { ok: false, error: `access: unexpected field(s) ${extra.join(", ")}` };
  if (typeof input.restricted !== "boolean") {
    return { ok: false, error: "access.restricted must be a boolean" };
  }
  const allow = input.allow === undefined ? [] : input.allow;
  if (!Array.isArray(allow) || allow.some((e) => typeof e !== "string")) {
    return { ok: false, error: "access.allow must be an array of strings" };
  }
  if (allow.length > KEY_ACCESS_MAX_ENTRIES) {
    return { ok: false, error: `access.allow has more than ${KEY_ACCESS_MAX_ENTRIES} entries` };
  }
  if (allow.some((e) => e.trim().length > KEY_ACCESS_MAX_ENTRY_LENGTH)) {
    return { ok: false, error: `access.allow entries must be at most ${KEY_ACCESS_MAX_ENTRY_LENGTH} characters` };
  }
  if (input.accountsRestricted !== undefined && typeof input.accountsRestricted !== "boolean") {
    return { ok: false, error: "access.accountsRestricted must be a boolean" };
  }
  const accountIds = input.accountIds === undefined ? [] : input.accountIds;
  if (!Array.isArray(accountIds) || accountIds.some((id) => typeof id !== "string")) {
    return { ok: false, error: "access.accountIds must be an array of strings" };
  }
  if (accountIds.length > KEY_ACCESS_MAX_ENTRIES) {
    return { ok: false, error: `access.accountIds has more than ${KEY_ACCESS_MAX_ENTRIES} entries` };
  }
  if (accountIds.some((id) => id.trim().length > KEY_ACCESS_MAX_ENTRY_LENGTH)) {
    return { ok: false, error: `access.accountIds entries must be at most ${KEY_ACCESS_MAX_ENTRY_LENGTH} characters` };
  }
  return { ok: true, value: { restricted: input.restricted, allow: normalizeAllowList(allow), accountsRestricted: input.accountsRestricted ?? false, accountIds: normalizeAccountIds(accountIds) } };
}
