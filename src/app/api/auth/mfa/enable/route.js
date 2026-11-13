import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { generateBackupCodes } from "@/lib/auth/backupCodes";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Finish enrollment: accept the candidate secret only after it produces a
 * valid code, then persist it alongside a fresh set of backup codes.
 * The plaintext backup codes are returned exactly once.
 */
export async function POST(request) {
  try {
    const settings = await getSettings();
    if (settings.mfaEnabled === true) {
      return NextResponse.json(
        { error: "MFA is already enabled. Disable it first to re-enroll." },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const { password, secret, code } = await request.json();

    if (!(await verifyDashboardPassword(password))) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    if (!secret || typeof secret !== "string") {
      return NextResponse.json(
        { error: "Missing enrollment secret. Restart setup." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // Proves the authenticator actually holds the secret before we lock the
    // account behind it.
    if (!verifyTotpCode(secret, code)) {
      return NextResponse.json(
        { error: "Invalid code. Check your authenticator and try again." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { codes, hashes } = await generateBackupCodes();
    await updateSettings({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: hashes });

    return NextResponse.json(
      { success: true, backupCodes: codes },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
