import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getSettings, getPasskeys } from "@/lib/localDb";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { isLocalRequest } from "@/dashboardGuard";
import {
  MAX_PASSKEYS,
  PASSKEY_ALGORITHMS,
  PASSKEY_RP_NAME,
  PASSKEY_USER_DISPLAY_NAME,
  PASSKEY_USER_NAME,
  getPasskeyUserId,
  hasDashboardAccess,
  resolveRelyingParty,
  saveChallenge,
  setChallengeCookie,
} from "@/lib/auth/passkey";
import { lockedResponse, passkeyErrorResponse, passkeyJson, readJsonBody } from "@/lib/auth/passkeyResponses";

export const dynamic = "force-dynamic";

// Authenticated: begins adding a passkey. Requires the current password again
// (step-up) so a stolen session cookie alone cannot plant a persistent credential.
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const settings = await getSettings();
    if (!(await hasDashboardAccess(cookieStore, settings))) {
      return passkeyJson({ error: "Unauthorized" }, 401);
    }

    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) return lockedResponse(lock);

    const { rpId, origin } = resolveRelyingParty(request);

    const { currentPassword } = await readJsonBody(request);
    if (!(await verifyDashboardPassword(currentPassword))) {
      recordFail(ip);
      const postLock = checkLock(ip);
      if (postLock.locked) return lockedResponse(postLock);
      return passkeyJson({ error: "Invalid current password" }, 401);
    }
    recordSuccess(ip);

    // Same rule as password login: the public default password must not be enough
    // to enrol a remote credential that would outlive a later password change.
    if (!settings.password && !process.env.INITIAL_PASSWORD && !isLocalRequest(request)) {
      return passkeyJson({ error: "Set a dashboard password before adding a passkey remotely." }, 403);
    }

    const existing = await getPasskeys();
    if (existing.length >= MAX_PASSKEYS) {
      return passkeyJson({ error: `You can register at most ${MAX_PASSKEYS} passkeys. Remove one first.` }, 409);
    }

    const options = await generateRegistrationOptions({
      rpName: PASSKEY_RP_NAME,
      rpID: rpId,
      userName: PASSKEY_USER_NAME,
      userDisplayName: PASSKEY_USER_DISPLAY_NAME,
      userID: getPasskeyUserId(),
      attestationType: "none",
      excludeCredentials: existing
        .filter((p) => p.rpId === rpId)
        .map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
    });

    const challengeId = saveChallenge({ challenge: options.challenge, type: "register", rpId, origin, client: ip });
    setChallengeCookie(cookieStore, request, challengeId);
    return passkeyJson(options);
  } catch (error) {
    return passkeyErrorResponse(error, "register options failed", "Could not start passkey registration");
  }
}
