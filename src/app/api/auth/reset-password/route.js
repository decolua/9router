import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
// Also steps "Passkey only" back to "Passkey + password": this is the owner's recovery
// path (lost authenticator, changed domain), and a reset password is useless while
// remote password login stays refused — e.g. under Docker, where no browser request
// counts as local. Registered passkeys keep working.
export async function POST() {
  try {
    const settings = await getSettings();
    const updates = { password: null };
    if (settings?.passkeyMode === "only") updates.passkeyMode = "on";
    await updateSettings(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
