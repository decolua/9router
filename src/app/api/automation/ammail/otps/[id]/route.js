import { NextResponse } from "next/server";
import { getAmmailOtp, markAmmailOtpUsed, deleteAmmailOtp } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const otpId = parseInt(resolvedParams.id);
    const otp = await getAmmailOtp(otpId);
    if (!otp) {
      return NextResponse.json({ error: "OTP not found" }, { status: 404 });
    }

    // Mark as read/used
    if (!otp.usedAt) {
      await markAmmailOtpUsed(otpId);
      otp.usedAt = Math.floor(Date.now() / 1000);
    }

    return NextResponse.json({
      ok: true,
      otp: {
        id: otp.id,
        address: otp.address,
        alias: otp.alias,
        domain: otp.domain,
        sender: otp.sender,
        subject: otp.subject,
        otp_code: otp.otpCode,
        verify_url: otp.verifyUrl,
        body_text: otp.bodyText,
        body_html: otp.bodyHtml,
        received_at: otp.receivedAt,
        used_at: otp.usedAt
      }
    });
  } catch (error) {
    console.error("Error in GET /api/automation/ammail/otps/[id]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const otpId = parseInt(resolvedParams.id);
    const body = await request.json();
    const { action } = body;

    if (action === "delete") {
      await deleteAmmailOtp(otpId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in POST /api/automation/ammail/otps/[id]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
