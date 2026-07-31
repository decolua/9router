/**
 * QoderWork CN connection profile helpers (local UX).
 * Userinfo has no dedicated phone field in current wire; mask only when
 * name/login looks phone-like. Check-in status maps sash daily-check-in.
 */

import { maskMiddle4, looksLikePhone } from "./codebuddyProfile.js";
/**
 * Merge profile fields into provider-specific data without accepting a newly
 * fetched raw phone number. A historical phone already present on a connection
 * is left untouched for backward compatibility and remains response-filtered.
 */
export function mergePersistedProfileData(existing, patch) {
  const safePatch = { ...(patch || {}) };
  delete safePatch.phone;
  return { ...(existing || {}), ...safePatch };
}

/**
 * @param {object|null|undefined} userinfo - GET openapi /api/v1/userinfo body
 * @returns {{
 *   displayName: string|null,
 *   phone: string|null,
 *   phoneMasked: string|null,
 *   loginSource: string|null,
 *   userId: string|null,
 * }}
 */
export function extractQoderworkProfileFromUserinfo(userinfo) {
  if (!userinfo || typeof userinfo !== "object") {
    return {
      displayName: null,
      phone: null,
      phoneMasked: null,
      loginSource: null,
      userId: null,
    };
  }
  const displayName =
    (typeof userinfo.name === "string" && userinfo.name.trim()) ||
    (typeof userinfo.username === "string" && userinfo.username.trim()) ||
    null;
  // Prefer explicit phone fields. Only fall back to name/username when the
  // entire value is phone-shaped (not aliyun7850... style logins).
  const explicit = [userinfo.phone, userinfo.mobile, userinfo.telephone]
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim());
  const fallback = [userinfo.name, userinfo.username]
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim())
    .filter((v) => /^\+?[\d\s-]{6,20}$/.test(v));

  let phone = null;
  for (const c of [...explicit, ...fallback]) {
    if (looksLikePhone(c)) {
      phone = c.replace(/\D/g, "");
      break;
    }
  }
  const phoneMasked = phone ? maskMiddle4(phone) : null;
  const loginSource =
    (typeof userinfo.source === "string" && userinfo.source.trim()) ||
    (Array.isArray(userinfo.third_party_identities) &&
      userinfo.third_party_identities[0]?.provider) ||
    null;
  const userId = typeof userinfo.id === "string" ? userinfo.id : null;
  return { displayName, phone, phoneMasked, loginSource, userId };
}

