import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";
import { setMeta } from "@/lib/db/helpers/metaStore.js";
import { LEGACY_GRACE_META_KEY } from "@/lib/auth/setupState";
import { issueSetupToken, printSetupBanner, SETUP_WINDOW_MS } from "@/lib/auth/setupToken";

// Clear the stored password and put the instance back into first-run setup:
// a fresh one-time token is minted and printed to the host console. There is no
// default password to fall back to.
// Local-only (enforced by dashboardGuard).
export async function POST() {
  try {
    // Order matters, and neither step may be best-effort: if the grace flag
    // survived a cleared hash the instance would report "legacy" — login would
    // accept the old default password while /setup rejected the fresh token.
    // Clearing the flag first means a failure here leaves the current password
    // untouched and mints nothing.
    await setMeta(LEGACY_GRACE_META_KEY, "0");
    await updateSettings({ password: null });

    const token = issueSetupToken();
    printSetupBanner(token, { reason: "password reset" });

    return NextResponse.json({
      success: true,
      token,
      expiresInSec: Math.round(SETUP_WINDOW_MS / 1000),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
