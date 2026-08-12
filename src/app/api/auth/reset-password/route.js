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
    await updateSettings({ password: null });
    // Never re-open the old default password on a reset.
    try { await setMeta(LEGACY_GRACE_META_KEY, "0"); } catch { /* best effort */ }

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
