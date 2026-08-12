import crypto from "node:crypto";

/**
 * codebuddyIdentity — stable per-credential device identity for CodeBuddy (Tencent).
 *
 * Tencent's server cross-references device fingerprints sent in /v2/report
 * telemetry. When 9router proxies many CodeBuddy keys from one host, every key
 * must present a STABLE, UNIQUE identity or the server flags the key as a
 * silent/bot client and bans it.
 *
 * All values are DERIVED deterministically from the credential so that:
 *   - the same credential always yields the same identity (stability across
 *     restarts and across the gateway fleet), and
 *   - different credentials never share an identity (no cross-contamination).
 *
 * Derivation uses a keyed SHA-256 over the raw credential material (accessToken
 * preferred, else apiKey). The raw secret is never stored, logged, or sent —
 * only the derived opaque fingerprints leave the process.
 *
 * This module is pure (no I/O, no network). All functions are fail-open: they
 * never throw, always returning a usable identity.
 */

const IDENTITY_VERSION = "1";

// Current official CLI build fingerprint (kept in sync with the registry UA).
// Source: @tencent-ai/codebuddy-code product.json (CLI 2.133.1).
export const CODEBUDDY_CLI_VERSION = "2.133.1";
export const CODEBUDDY_BUILD = {
  releaseDate: 1785400746436,
  commit: "e9991e2be9dcafcce0fad23fc065dd91a7f3efed",
};

// The credential material that anchors identity. accessToken rotates on refresh,
// so prefer the LONGEST-LIVED secret available. apiKey (when present) is the
// most stable; otherwise fall back to refreshToken, then accessToken.
function credentialSeed(credentials) {
  if (!credentials || typeof credentials !== "object") return "anonymous";
  const seed =
    credentials.apiKey ||
    credentials.refreshToken ||
    credentials.accessToken ||
    credentials.id ||
    credentials.connectionId ||
    "anonymous";
  return String(seed);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function md5Hex(input) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

// Derive a UUID-shaped string from a hex hash (deterministic, RFC-4122 layout).
function hashToUuid(hex) {
  const h = hex.replace(/[^0-9a-f]/gi, "").toLowerCase();
  const b = (h + h + h).slice(0, 32); // ensure 32 hex chars
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20, 32)}`;
}

/** qimei36 — Tencent QIMEI device fingerprint. 36 hex chars, stable per credential. */
export function deriveQimei36(credentials) {
  try {
    const seed = `${IDENTITY_VERSION}|qimei36|${credentialSeed(credentials)}`;
    return sha256Hex(seed).slice(0, 36);
  } catch {
    return sha256Hex(`${IDENTITY_VERSION}|qimei36|fallback`).slice(0, 36);
  }
}

/** machineId — stable machine UUID per credential. */
export function deriveMachineId(credentials) {
  try {
    const seed = `${IDENTITY_VERSION}|machineId|${credentialSeed(credentials)}`;
    return hashToUuid(sha256Hex(seed));
  } catch {
    return hashToUuid(sha256Hex(`${IDENTITY_VERSION}|machineId|fallback`));
  }
}

/**
 * sessionId — per-session correlation UUID. A "session" maps to a credential's
 * active working period; we keep it stable per credential so a long-running
 * gateway behaves like one long official-CLI session (matches how the official
 * client holds one sessionId for its whole process lifetime).
 */
export function deriveSessionId(credentials) {
  try {
    const seed = `${IDENTITY_VERSION}|sessionId|${credentialSeed(credentials)}`;
    return hashToUuid(sha256Hex(seed));
  } catch {
    return hashToUuid(sha256Hex(`${IDENTITY_VERSION}|sessionId|fallback`));
  }
}

/** deviceId — MD5(hostname-platform)[:16] equivalent, stable per credential. */
export function deriveDeviceId(credentials) {
  try {
    const seed = `${IDENTITY_VERSION}|deviceId|${credentialSeed(credentials)}`;
    return md5Hex(seed).slice(0, 16);
  } catch {
    return md5Hex(`${IDENTITY_VERSION}|deviceId|fallback`).slice(0, 16);
  }
}

/** hostId — SHA256(host fingerprint)[:32] equivalent, stable per credential. */
export function deriveHostId(credentials) {
  try {
    const seed = `${IDENTITY_VERSION}|hostId|${credentialSeed(credentials)}`;
    return sha256Hex(seed).slice(0, 32);
  } catch {
    return sha256Hex(`${IDENTITY_VERSION}|hostId|fallback`).slice(0, 32);
  }
}

/**
 * Consistent-but-fake VCS (git) identity per credential. Adds dev-context
 * credibility to report events without leaking any real repository.
 */
export function deriveVcsInfo(credentials) {
  const hex = sha256Hex(`${IDENTITY_VERSION}|vcs|${credentialSeed(credentials)}`);
  return {
    vcsType: "git",
    vcsRepo: `github.com/user/project-${hex.slice(0, 6)}`,
    vcsBranchName: "main",
    vcsRevId: hex.slice(0, 40),
  };
}

/**
 * Consistent-but-fake hardware profile per credential. Values vary slightly
 * (derived from the credential) so a fleet of keys doesn't present one
 * perfectly uniform hardware signature.
 */
export function deriveHardwareProfile(credentials) {
  const hex = md5Hex(`${IDENTITY_VERSION}|hw|${credentialSeed(credentials)}`);
  const a = parseInt(hex[0], 16) || 0;
  const b = parseInt(hex[1], 16) || 0;
  return {
    os: "win32",
    arch: "x64",
    osVersion: "10.0.26200",
    cpuModel: "13th Gen Intel(R) Core(TM) i5-13420H",
    cpuCores: 12 + (a % 4), // 12-15
    memorySize: 16 + (b % 2) * 16, // 16 or 32
    timezone: "Asia/Shanghai",
  };
}

/**
 * Aggregate the full stable identity for a credential in one call.
 * Fail-open: always returns a complete object.
 */
export function getCodebuddyIdentity(credentials) {
  try {
    return {
      qimei36: deriveQimei36(credentials),
      machineId: deriveMachineId(credentials),
      sessionId: deriveSessionId(credentials),
      deviceId: deriveDeviceId(credentials),
      hostId: deriveHostId(credentials),
      vcs: deriveVcsInfo(credentials),
      hardware: deriveHardwareProfile(credentials),
      cliVersion: CODEBUDDY_CLI_VERSION,
      build: CODEBUDDY_BUILD,
    };
  } catch {
    // Absolute last-resort fallback (should be unreachable given per-fn guards).
    const fb = getCodebuddyIdentity.__fb || (getCodebuddyIdentity.__fb = {
      qimei36: sha256Hex("fb|q").slice(0, 36),
      machineId: hashToUuid(sha256Hex("fb|m")),
      sessionId: hashToUuid(sha256Hex("fb|s")),
      deviceId: md5Hex("fb|d").slice(0, 16),
      hostId: sha256Hex("fb|h").slice(0, 32),
      vcs: { vcsType: "git", vcsRepo: "github.com/user/project", vcsBranchName: "main", vcsRevId: sha256Hex("fb|r").slice(0, 40) },
      hardware: { os: "win32", arch: "x64", osVersion: "10.0.26200", cpuModel: "13th Gen Intel(R) Core(TM) i5-13420H", cpuCores: 12, memorySize: 32, timezone: "Asia/Shanghai" },
      cliVersion: CODEBUDDY_CLI_VERSION,
      build: CODEBUDDY_BUILD,
    });
    return fb;
  }
}

export default getCodebuddyIdentity;
