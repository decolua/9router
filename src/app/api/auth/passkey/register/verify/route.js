import { cookies } from "next/headers";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getSettings, countPasskeys, getPasskeyById, createPasskey } from "@/lib/localDb";
import {
  CHALLENGE_COOKIE,
  MAX_PASSKEYS,
  PASSKEY_ALGORITHMS,
  clearChallengeCookie,
  consumeChallenge,
  hasDashboardAccess,
  isValidCredentialId,
  resolveRelyingParty,
  sanitizePasskeyName,
  toBase64Url,
  toPublicPasskey,
} from "@/lib/auth/passkey";
import { passkeyErrorResponse, passkeyJson, readJsonBody } from "@/lib/auth/passkeyResponses";

export const dynamic = "force-dynamic";

const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

// Authenticated: stores the new credential once the attestation verifies.
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const challenge = consumeChallenge(cookieStore.get(CHALLENGE_COOKIE)?.value, "register");
    clearChallengeCookie(cookieStore, request);

    const settings = await getSettings();
    if (!(await hasDashboardAccess(cookieStore, settings))) {
      return passkeyJson({ error: "Unauthorized" }, 401);
    }
    if (!challenge) {
      return passkeyJson({ error: "Passkey registration expired. Start again." }, 400);
    }

    const rp = resolveRelyingParty(request);
    if (rp.rpId !== challenge.rpId || rp.origin !== challenge.origin) {
      return passkeyJson({ error: "Passkey registration origin changed. Start again." }, 400);
    }

    const { response, name } = await readJsonBody(request);
    if (!response || typeof response !== "object") {
      return passkeyJson({ error: "Missing passkey response" }, 400);
    }

    if (await countPasskeys() >= MAX_PASSKEYS) {
      return passkeyJson({ error: `You can register at most ${MAX_PASSKEYS} passkeys. Remove one first.` }, 409);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
      });
    } catch (error) {
      console.warn(`[passkey] registration rejected: ${error?.message || error}`);
      return passkeyJson({ error: "Passkey registration failed" }, 400);
    }
    if (!verification?.verified || !verification.registrationInfo) {
      return passkeyJson({ error: "Passkey registration failed" }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (!isValidCredentialId(credential?.id) || !credential.publicKey) {
      return passkeyJson({ error: "Passkey registration failed" }, 400);
    }
    if (await getPasskeyById(credential.id)) {
      return passkeyJson({ error: "This passkey is already registered" }, 409);
    }

    const reportedTransports = Array.isArray(credential.transports)
      ? credential.transports
      : Array.isArray(response.response?.transports) ? response.response.transports : [];

    const saved = await createPasskey({
      id: credential.id,
      publicKey: toBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: reportedTransports.filter((t) => TRANSPORTS.has(t)),
      rpId: challenge.rpId,
      name: sanitizePasskeyName(name),
      deviceType: credentialDeviceType === "multiDevice" ? "multiDevice" : "singleDevice",
      backedUp: credentialBackedUp === true,
    });

    return passkeyJson({ success: true, passkey: toPublicPasskey(saved) });
  } catch (error) {
    return passkeyErrorResponse(error, "register verify failed", "Passkey registration failed");
  }
}
