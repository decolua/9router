import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getSettings } from "@/lib/localDb";
import { checkLock, getClientIp } from "@/lib/auth/loginLimiter";
import { isTunnelLoginBlocked } from "@/lib/auth/tunnelAccess";
import { getEffectivePasskeyMode } from "@/lib/auth/passkeyMode";
import { resolveRelyingParty, saveChallenge, setChallengeCookie } from "@/lib/auth/passkey";
import { lockedResponse, passkeyErrorResponse, passkeyJson } from "@/lib/auth/passkeyResponses";

export const dynamic = "force-dynamic";

// Public: begins a discoverable-credential sign-in. allowCredentials stays empty so
// unauthenticated callers never learn which credential IDs exist. The challenge is
// tagged with the caller's limiter bucket so repeated requests only displace that
// caller's own pending challenges (see saveChallenge).
export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) return lockedResponse(lock);

    const settings = await getSettings();
    if (await getEffectivePasskeyMode(settings) === "off") {
      return passkeyJson({ error: "Passkey sign-in is disabled" }, 404);
    }
    if (isTunnelLoginBlocked(request, settings)) {
      return passkeyJson({ error: "Dashboard access via tunnel is disabled" }, 403);
    }

    const { rpId, origin } = resolveRelyingParty(request);
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: "required",
      allowCredentials: [],
    });

    const challengeId = saveChallenge({ challenge: options.challenge, type: "login", rpId, origin, client: ip });
    setChallengeCookie(await cookies(), request, challengeId);
    return passkeyJson(options);
  } catch (error) {
    return passkeyErrorResponse(error, "login options failed", "Passkey sign-in is unavailable");
  }
}
