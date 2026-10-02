import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { generateTotpSecret, buildOtpAuthUri } from "@/lib/auth/totp";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Begin enrollment: mint a candidate secret and render its QR.
 * Nothing is persisted here — the secret only takes effect once the user proves
 * they can generate a code from it (POST /api/auth/mfa/enable).
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

    // Re-auth: an unattended session must not be able to bind a new factor.
    const { password } = await request.json();
    if (!(await verifyDashboardPassword(password))) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const secret = generateTotpSecret();
    const otpauthUri = buildOtpAuthUri({ secret, account: "admin" });
    const qrCodeDataUri = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });

    return NextResponse.json(
      { secret, otpauthUri, qrCodeDataUri },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
