import { cookies } from "next/headers";
import { getSettings, getPasskeys } from "@/lib/localDb";
import { MAX_PASSKEYS, hasDashboardAccess, toPublicPasskey } from "@/lib/auth/passkey";
import { getPasskeyLoginState } from "@/lib/auth/passkeyMode";
import { passkeyErrorResponse, passkeyJson } from "@/lib/auth/passkeyResponses";

export const dynamic = "force-dynamic";

// Authenticated: lists registered passkeys for the settings page. Public keys and
// counters never leave the server. Reports both the stored mode and the mode the login
// routes enforce (they differ under SSO-only, PASSKEY_MODE_OVERRIDE, or "only" without a
// passkey usable remotely) so the card never claims a stricter posture than is active.
export async function GET() {
  try {
    const cookieStore = await cookies();
    const settings = await getSettings();
    if (!(await hasDashboardAccess(cookieStore, settings))) {
      return passkeyJson({ error: "Unauthorized" }, 401);
    }
    const passkeys = (await getPasskeys()).map(toPublicPasskey);
    const state = await getPasskeyLoginState(settings);
    return passkeyJson({
      passkeys,
      passkeyMode: state.mode,
      effectivePasskeyMode: state.effectiveMode,
      passkeyModeReason: state.reason,
      maxPasskeys: MAX_PASSKEYS,
    });
  } catch (error) {
    return passkeyErrorResponse(error, "list credentials failed", "Could not load passkeys");
  }
}
