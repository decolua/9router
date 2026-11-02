import { countPasskeys, countRemotePasskeys } from "@/lib/localDb";
import { getEnforcedSsoType } from "@/lib/auth/ssoPolicy";

// Kept separate from passkey.js so password/status/settings routes can read the
// mode without loading the WebAuthn library.
export const PASSKEY_MODES = ["off", "on", "only"];
const MODE_RANK = { off: 0, on: 1, only: 2 };

export function normalizePasskeyMode(value) {
  return PASSKEY_MODES.includes(value) ? value : "off";
}

export function isLocalhostRpId(rpId) {
  const name = String(rpId || "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost");
}

// Operator recovery switch for hosts where no browser request ever counts as local
// (e.g. Docker: the host browser reaches the container from the bridge gateway).
// PASSKEY_MODE_OVERRIDE=on|off can only loosen the stored mode, never tighten it.
function envModeCap() {
  const value = process.env.PASSKEY_MODE_OVERRIDE;
  return value === "on" || value === "off" ? value : null;
}

// Resolves the stored mode into what the login routes actually enforce:
// - PASSKEY_MODE_OVERRIDE caps it ("override").
// - SSO-only login turns passkey sign-in off ("sso"): a passkey must not bypass the IdP.
// - "only" needs ≥1 passkey usable remotely (not bound to localhost). Settings can still
//   say "only" without one (passkeys are not part of exportDb/importDb, and localhost
//   passkeys never help a remote owner); treat it as "on" instead of locking remote
//   owners out entirely ("no-remote-passkey").
// `available` is whether a passkey sign-in can succeed at all (mode on and ≥1 enrolled).
export async function getPasskeyLoginState(settings) {
  const mode = normalizePasskeyMode(settings?.passkeyMode);
  let effectiveMode = mode;
  let reason = null;

  const cap = envModeCap();
  if (cap && MODE_RANK[cap] < MODE_RANK[effectiveMode]) {
    effectiveMode = cap;
    reason = "override";
  }
  if (effectiveMode !== "off" && getEnforcedSsoType(settings)) {
    effectiveMode = "off";
    reason = "sso";
  }
  if (effectiveMode === "off") return { mode, effectiveMode, available: false, reason };

  const count = await countPasskeys();
  if (effectiveMode === "only" && (count === 0 || (await countRemotePasskeys()) === 0)) {
    effectiveMode = "on";
    reason = "no-remote-passkey";
  }
  return { mode, effectiveMode, available: count > 0, reason };
}

export async function getEffectivePasskeyMode(settings) {
  return (await getPasskeyLoginState(settings)).effectiveMode;
}
