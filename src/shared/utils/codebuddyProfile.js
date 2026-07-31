/**
 * CodeBuddy CN connection profile helpers (local UX).
 * Mask phone for badges; decode JWT claims for manual profile refresh.
 */

const BASE64_BLOCK_SIZE = 4;

/**
 * Mask the middle 4 characters of any string (works for multi-country phone lengths).
 * @param {string} value
 * @returns {string}
 */
export function maskMiddle4(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length <= 4) return "*".repeat(s.length);
  if (s.length === 5) return `${s[0]}***${s[4]}`;
  if (s.length === 6) return `${s.slice(0, 1)}****${s.slice(5)}`;
  const start = Math.floor((s.length - 4) / 2);
  return `${s.slice(0, start)}****${s.slice(start + 4)}`;
}

/**
 * Decode a JWT payload without verifying the signature (display / local field only).
 * Works in Node (Buffer) and browser (atob).
 * @param {string} jwt
 * @returns {Record<string, unknown>|null}
 */
export function decodeJwtPayloadSafe(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const padded = base64 + "=".repeat(missingPadding);
    let json;
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(padded, "base64").toString("utf8");
    } else if (typeof atob === "function") {
      json = decodeURIComponent(
        Array.from(atob(padded), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
      );
    } else {
      return null;
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Whether a string looks like a phone / login id we should mask as a phone badge.
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikePhone(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  // digits with optional leading +, spaces, dashes — strip non-digits for length check
  const digits = s.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * Extract display name + phone fields from a CodeBuddy access token JWT.
 * @param {string} accessToken
 * @returns {{ nickname: string|null, phone: string|null, phoneMasked: string|null, sub: string|null }}
 */
export function extractCodebuddyProfileFromToken(accessToken) {
  const payload = decodeJwtPayloadSafe(accessToken);
  if (!payload || typeof payload !== "object") {
    return { nickname: null, phone: null, phoneMasked: null, sub: null };
  }
  const nickname =
    (typeof payload.nickname === "string" && payload.nickname.trim()) ||
    (typeof payload.name === "string" && payload.name.trim()) ||
    null;
  const preferred =
    typeof payload.preferred_username === "string" ? payload.preferred_username.trim() : "";
  const digits = preferred.replace(/\D/g, "");
  const phone = looksLikePhone(preferred) ? digits : null;
  const phoneMasked = phone ? maskMiddle4(phone) : null;
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  return {
    nickname,
    phone,
    phoneMasked,
    sub,
  };
}
