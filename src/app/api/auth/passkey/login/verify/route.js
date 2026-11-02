import { cookies } from "next/headers";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getSettings, getPasskeyById, updatePasskeyUsage } from "@/lib/localDb";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isTunnelLoginBlocked } from "@/lib/auth/tunnelAccess";
import { getEffectivePasskeyMode } from "@/lib/auth/passkeyMode";
import {
  CHALLENGE_COOKIE,
  PasskeyError,
  clearChallengeCookie,
  consumeChallenge,
  fromBase64Url,
  isValidCredentialId,
  resolveRelyingParty,
} from "@/lib/auth/passkey";
import { lockedResponse, passkeyErrorResponse, passkeyJson, readJsonBody } from "@/lib/auth/passkeyResponses";

export const dynamic = "force-dynamic";

const GENERIC_FAILURE = "Passkey sign-in failed";
const EXPIRED = "Passkey sign-in expired. Try again.";

// Public: finishes a passkey sign-in and issues the dashboard session.
export async function POST(request) {
  const ip = getClientIp(request);
  try {
    // The challenge is single-use: consume it and clear the cookie before any check can bail out.
    const cookieStore = await cookies();
    const challenge = consumeChallenge(cookieStore.get(CHALLENGE_COOKIE)?.value, "login");
    clearChallengeCookie(cookieStore, request);

    const lock = checkLock(ip);
    if (lock.locked) return lockedResponse(lock);

    const settings = await getSettings();
    if (await getEffectivePasskeyMode(settings) === "off") {
      return passkeyJson({ error: "Passkey sign-in is disabled" }, 404);
    }
    if (isTunnelLoginBlocked(request, settings)) {
      return passkeyJson({ error: "Dashboard access via tunnel is disabled" }, 403);
    }

    // A missing, expired or reused challenge proves nothing about credential guessing:
    // nothing gets verified without one. It is NOT counted against the limiter, so a
    // flood that evicts or outlasts the owner's challenge cannot also lock them out.
    if (!challenge) {
      console.warn("[passkey] sign-in rejected: missing, expired or reused challenge");
      return passkeyJson({ error: EXPIRED }, 400);
    }

    // Every rejection below counts against the limiter and answers the same generic
    // 401, so a caller cannot tell which check failed. Detail goes to the server log only.
    const fail = (reason) => {
      console.warn(`[passkey] sign-in rejected: ${reason}`);
      recordFail(ip);
      const postLock = checkLock(ip);
      if (postLock.locked) return lockedResponse(postLock);
      return passkeyJson({ error: GENERIC_FAILURE }, 401);
    };

    let rp;
    try {
      rp = resolveRelyingParty(request);
    } catch (error) {
      if (error instanceof PasskeyError) return fail(`origin rejected (${error.message})`);
      throw error;
    }
    if (rp.rpId !== challenge.rpId || rp.origin !== challenge.origin) return fail("origin differs from challenge");

    const { response } = await readJsonBody(request);
    if (!response || typeof response !== "object" || !isValidCredentialId(response.id)) {
      return fail("malformed assertion");
    }

    const credential = await getPasskeyById(response.id);
    if (!credential) return fail("unknown credential");
    if (credential.rpId !== challenge.rpId) return fail("credential registered for another RP ID");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpId,
        credential: {
          id: credential.id,
          publicKey: fromBase64Url(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: true,
      });
    } catch (error) {
      return fail(`verification error: ${error?.message || error}`);
    }
    if (!verification?.verified) return fail("assertion not verified");

    await updatePasskeyUsage(credential.id, verification.authenticationInfo?.newCounter ?? credential.counter);
    recordSuccess(ip);
    await setDashboardAuthCookie(cookieStore, request, {
      passkey: true,
      passkeyId: credential.id,
      passkeyName: credential.name || "Passkey",
    });
    return passkeyJson({ success: true });
  } catch (error) {
    return passkeyErrorResponse(error, "login verify failed", GENERIC_FAILURE);
  }
}
