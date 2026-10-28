// Single-use MFA recovery codes. Stored bcrypt-hashed, never recoverable after
// generation — the plaintext set is shown to the user exactly once.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const BACKUP_CODE_COUNT = 10;
const GROUP_LEN = 5;
// Crockford-ish base32: no 0/O/1/I/L/U to avoid transcription errors.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const BCRYPT_ROUNDS = 10;

function randomChars(length) {
  // Rejection-free: 30 divides evenly into 240, so mod bias is avoided by
  // discarding the top of the byte range.
  const out = [];
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      if (byte >= 240) continue; // 240 = 8 * 30
      out.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** e.g. "A3F7K-QM29X" — 10 chars of entropy, ~49 bits. */
export function generateBackupCode() {
  return `${randomChars(GROUP_LEN)}-${randomChars(GROUP_LEN)}`;
}

/** Normalize user input: strip separators/whitespace, uppercase. */
export function normalizeBackupCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Generate a fresh set. Returns { codes, hashes } — `codes` is displayed once
 * and then discarded; only `hashes` is persisted.
 */
export async function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const codes = Array.from({ length: count }, () => generateBackupCode());
  const hashes = await Promise.all(
    codes.map((code) => bcrypt.hash(normalizeBackupCode(code), BCRYPT_ROUNDS)),
  );
  return { codes, hashes };
}

/**
 * Check a submitted code against the stored hashes.
 * Returns { matched, remainingHashes } — on a match the used hash is removed so
 * the code cannot be replayed. Callers MUST persist remainingHashes.
 */
export async function consumeBackupCode(input, hashes = []) {
  const candidate = normalizeBackupCode(input);
  const list = Array.isArray(hashes) ? hashes : [];
  if (!candidate) return { matched: false, remainingHashes: list };

  for (let i = 0; i < list.length; i += 1) {
    let ok = false;
    try {
      ok = await bcrypt.compare(candidate, list[i]);
    } catch {
      ok = false;
    }
    if (ok) {
      const remainingHashes = list.slice(0, i).concat(list.slice(i + 1));
      return { matched: true, remainingHashes };
    }
  }
  return { matched: false, remainingHashes: list };
}
