import { cookies } from "next/headers";
import { getSettings, getPasskeyById, renamePasskey, deletePasskey, countRemotePasskeys } from "@/lib/localDb";
import { hasDashboardAccess, isValidCredentialId, sanitizePasskeyName, toPublicPasskey } from "@/lib/auth/passkey";
import { isLocalhostRpId, normalizePasskeyMode } from "@/lib/auth/passkeyMode";
import { passkeyErrorResponse, passkeyJson, readJsonBody } from "@/lib/auth/passkeyResponses";

export const dynamic = "force-dynamic";

async function authorize() {
  const cookieStore = await cookies();
  const settings = await getSettings();
  if (!(await hasDashboardAccess(cookieStore, settings))) return { denied: passkeyJson({ error: "Unauthorized" }, 401) };
  return { settings };
}

async function readId(params) {
  // Credential ids are base64url, so they never need URL decoding.
  const { id } = await params;
  return isValidCredentialId(id) ? id : null;
}

// Authenticated: rename a passkey.
export async function PATCH(request, { params }) {
  try {
    const { denied } = await authorize();
    if (denied) return denied;

    const id = await readId(params);
    if (!id) return passkeyJson({ error: "Passkey not found" }, 404);

    const { name } = await readJsonBody(request);
    if (typeof name !== "string") return passkeyJson({ error: "Name is required" }, 400);

    const updated = await renamePasskey(id, sanitizePasskeyName(name));
    if (!updated) return passkeyJson({ error: "Passkey not found" }, 404);
    return passkeyJson({ success: true, passkey: toPublicPasskey(updated) });
  } catch (error) {
    return passkeyErrorResponse(error, "rename credential failed", "Could not rename passkey");
  }
}

// Authenticated: remove a passkey. While "Passkey only" is on, the last passkey usable
// remotely (any RP ID except localhost / *.localhost) cannot be removed: switch the mode
// back first. A passkey under a different domain still lets the owner sign in from that
// domain, but a localhost one only works on the host, where password login is allowed
// anyway, so localhost passkeys can always be removed and never count as the "last" one.
export async function DELETE(request, { params }) {
  try {
    const { settings, denied } = await authorize();
    if (denied) return denied;

    const id = await readId(params);
    const target = id ? await getPasskeyById(id) : null;
    if (!target) return passkeyJson({ error: "Passkey not found" }, 404);

    if (
      normalizePasskeyMode(settings.passkeyMode) === "only" &&
      !isLocalhostRpId(target.rpId) &&
      (await countRemotePasskeys()) <= 1
    ) {
      return passkeyJson(
        { error: "Cannot remove the last passkey for a domain while \"Passkey only\" is enabled. Change the passkey mode first." },
        409
      );
    }

    const removed = await deletePasskey(id);
    if (!removed) return passkeyJson({ error: "Passkey not found" }, 404);
    return passkeyJson({ success: true });
  } catch (error) {
    return passkeyErrorResponse(error, "delete credential failed", "Could not remove passkey");
  }
}
