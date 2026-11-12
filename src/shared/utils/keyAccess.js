// Per-API-key access control: pure helpers (no DB, no
// request objects), shared by the DB repo, the API routes and the engine.
import {
  KEY_ACCESS_MAX_ENTRIES,
  KEY_ACCESS_MAX_ENTRY_LENGTH,
  KEY_ACCESS_MAX_PINNED_PER_PROVIDER,
  KEY_ACCESS_MAX_PINNED_PROVIDERS,
  KEY_ACCESS_UNRESTRICTED,
} from "@/shared/constants/keyAccess.js";

/**
 * Normalize account pins `{ providerId: connectionId[] }`: lower-case provider
 * ids, trimmed de-duplicated connection ids, and providers with no ids dropped
 * (an empty list means "no pin", never "no account allowed").
 */
export function normalizeConnectionPins(pins) {
  const out = {};
  if (!pins || typeof pins !== "object" || Array.isArray(pins)) return out;
  for (const [provider, ids] of Object.entries(pins)) {
    const p = String(provider).trim().toLowerCase();
    if (!p || !Array.isArray(ids)) continue;
    const list = [...new Set(ids.filter((i) => typeof i === "string").map((i) => i.trim()).filter(Boolean))];
    if (list.length) out[p] = list;
  }
  return out;
}

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
 * Build the access object from the two apiKeys columns.
 *
 * Fails CLOSED: the restricted flag has its own INTEGER column, so a corrupt or
 * unparsable allow list can only ever shrink what a restricted key may call
 * (to nothing); it can never turn a restricted key into an unrestricted one.
 */
export function keyAccessFromColumns(restrictedCol, allowCol, connectionsCol) {
  const restricted = restrictedCol === 1 || restrictedCol === true;
  const access = { restricted, allow: [] };
  if (restricted) {
    let parsed = [];
    if (typeof allowCol === "string" && allowCol) {
      try { parsed = JSON.parse(allowCol); } catch { parsed = []; }
    }
    access.allow = normalizeAllowList(parsed);
  }
  // Account pins are independent of `restricted`; the field only appears when
  // the key actually has pins, so unpinned keys keep today's exact shape.
  if (typeof connectionsCol === "string" && connectionsCol) {
    let parsed = {};
    try { parsed = JSON.parse(connectionsCol); } catch { parsed = {}; }
    const pins = normalizeConnectionPins(parsed);
    if (Object.keys(pins).length) access.connections = pins;
  }
  return access;
}

/** Columns to persist for an access object (already validated/normalized). */
export function keyAccessToColumns(access) {
  const value = access || KEY_ACCESS_UNRESTRICTED;
  return {
    accessRestricted: value.restricted ? 1 : 0,
    accessAllow: JSON.stringify(value.restricted ? normalizeAllowList(value.allow) : []),
    accessConnections: (() => {
      const pins = normalizeConnectionPins(value.connections);
      return Object.keys(pins).length ? JSON.stringify(pins) : null;
    })(),
  };
}

/**
 * Validate client input for an access update ({ restricted, allow }).
 * Rejects rather than repairs: wrong types, too many entries, overlong entries.
 * @returns {{ ok: true, value: {restricted: boolean, allow: string[]} } | { ok: false, error: string }}
 */
export function validateKeyAccessInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "access must be an object { restricted, allow }" };
  }
  const extra = Object.keys(input).filter((k) => k !== "restricted" && k !== "allow" && k !== "connections");
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
  const value = { restricted: input.restricted, allow: normalizeAllowList(allow) };
  // `connections` is optional: omitted = leave the key's current pins untouched.
  if (input.connections !== undefined) {
    const pins = input.connections;
    if (!pins || typeof pins !== "object" || Array.isArray(pins)) {
      return { ok: false, error: "access.connections must be an object { providerId: connectionId[] }" };
    }
    const entries = Object.entries(pins);
    if (entries.length > KEY_ACCESS_MAX_PINNED_PROVIDERS) {
      return { ok: false, error: `access.connections has more than ${KEY_ACCESS_MAX_PINNED_PROVIDERS} providers` };
    }
    for (const [provider, ids] of entries) {
      if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
        return { ok: false, error: `access.connections.${provider} must be an array of connection ids` };
      }
      if (ids.length > KEY_ACCESS_MAX_PINNED_PER_PROVIDER) {
        return { ok: false, error: `access.connections.${provider} has more than ${KEY_ACCESS_MAX_PINNED_PER_PROVIDER} entries` };
      }
      if (ids.some((i) => i.trim().length > KEY_ACCESS_MAX_ENTRY_LENGTH)) {
        return { ok: false, error: `access.connections.${provider} ids must be at most ${KEY_ACCESS_MAX_ENTRY_LENGTH} characters` };
      }
    }
    value.connections = normalizeConnectionPins(pins);
  }
  return { ok: true, value };
}
