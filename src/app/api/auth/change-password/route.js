import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getDashboardAuthSession, setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { getAuthBootstrapState, validateNewPassword, clearLegacyGrace } from "@/lib/auth/setupState";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// Completes the forced password change for a legacy install. The caller holds a
// restricted session (issued by the login route after a last default-password
// login), which is only good for this endpoint — so the old password is not
// asked for again. On success a full session replaces the restricted one.
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const settings = await getSettings();
    const state = await getAuthBootstrapState(settings);
    if (state !== "legacy") {
      return NextResponse.json(
        { error: "No password change is pending. Use the profile settings instead." },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const { newPassword } = await request.json();
    const policy = validateNewPassword(newPassword);
    if (!policy.ok) {
      return NextResponse.json({ error: policy.error }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    // Persist the replacement hash before revoking the old way in, so a failed
    // write cannot leave the install with neither.
    await updateSettings({ password: hash });
    await clearLegacyGrace();

    // Swap the restricted session for a full one.
    await setDashboardAuthCookie(cookieStore, request);

    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
