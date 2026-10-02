// RFC 6238 TOTP (RFC 4226 HOTP with a time-derived counter) on node:crypto.
// Hand-rolled to avoid a runtime dependency for ~60 lines of well-specified math.
import crypto from "node:crypto";

export const TOTP_STEP_SEC = 30;      // RFC 6238 recommended time step
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = "sha1"; // what authenticator apps assume by default
export const TOTP_SKEW_STEPS = 1;     // accept prev/current/next step (~90s worst case)

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 encode, no padding (authenticator apps dislike "="). */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4648 base32 decode. Tolerates lowercase, spaces and "=" padding. */
export function base32Decode(input) {
  const clean = String(input || "").toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** New random TOTP secret. 20 bytes = SHA-1 block-friendly, per RFC 4226 §4. */
export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** RFC 4226 §5.3: HMAC, dynamic truncation, mod 10^digits. */
export function generateTotpCode(secret, counter, digits = TOTP_DIGITS) {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(TOTP_ALGORITHM, key).update(message).digest();

  // Dynamic truncation: low nibble of the last byte picks the 4-byte window.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Current time step. */
export function totpCounter(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / TOTP_STEP_SEC);
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a submitted code against ±skew time steps.
 * Returns false (never throws) on malformed input so callers can treat it as a
 * plain auth failure and feed it to the rate limiter.
 */
export function verifyTotpCode(secret, token, { skew = TOTP_SKEW_STEPS, atMs = Date.now() } = {}) {
  const code = String(token || "").replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(code)) return false;

  const counter = totpCounter(atMs);
  for (let drift = -skew; drift <= skew; drift += 1) {
    let expected;
    try {
      expected = generateTotpCode(secret, counter + drift);
    } catch {
      return false;
    }
    if (timingSafeEqualStr(expected, code)) return true;
  }
  return false;
}

/** otpauth:// URI consumed by authenticator apps (and encoded into the QR). */
export function buildOtpAuthUri({ secret, account = "admin", issuer = "9Router" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: TOTP_ALGORITHM.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
