// MFA state + second-factor verification shared by the login and enrollment routes.
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyTotpCode } from "./totp.js";
import { consumeBackupCode } from "./backupCodes.js";

/** True when a second factor must be presented for password logins. */
export function isMfaEnabled(settings) {
  return settings?.mfaEnabled === true && !!settings?.mfaSecret;
}

export async function isMfaEnabledNow() {
  return isMfaEnabled(await getSettings());
}

/**
 * Verify a second factor. Accepts a 6-digit TOTP or a single-use backup code.
 * A consumed backup code is removed from storage before this resolves, so a
 * replay of the same code fails.
 *
 * Returns { ok, method, backupCodesRemaining }.
 */
export async function verifySecondFactor(input) {
  const settings = await getSettings();
  if (!isMfaEnabled(settings)) return { ok: false, method: null };

  const candidate = String(input || "").trim();
  if (!candidate) return { ok: false, method: null };

  // A bare 6-digit value is a TOTP; anything else can only be a backup code.
  if (/^\d{6}$/.test(candidate.replace(/\s/g, ""))) {
    if (verifyTotpCode(settings.mfaSecret, candidate)) {
      return {
        ok: true,
        method: "totp",
        backupCodesRemaining: (settings.mfaBackupCodes || []).length,
      };
    }
    return { ok: false, method: null };
  }

  const { matched, remainingHashes } = await consumeBackupCode(
    candidate,
    settings.mfaBackupCodes || [],
  );
  if (!matched) return { ok: false, method: null };

  // Burn the code immediately — single use is the whole point.
  await updateSettings({ mfaBackupCodes: remainingHashes });
  return { ok: true, method: "backup", backupCodesRemaining: remainingHashes.length };
}

/** Turn MFA off and wipe every stored secret/recovery hash. */
export async function disableMfa() {
  await updateSettings({ mfaEnabled: false, mfaSecret: "", mfaBackupCodes: [] });
}
