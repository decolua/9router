import { NextResponse } from "next/server";
import { consumePasswordResetToken } from "@/lib/auth/passwordReset";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export async function POST(request) {
  try {
    const { token, newPassword } = await request.json();
    if (!token || !newPassword) {
      return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
    }

    await consumePasswordResetToken(token, newPassword);
    await auditFromRequest(request, {
      action: AuditAction.PASSWORD_CHANGED,
      targetType: "user",
      outcome: "success",
      meta: { via: "reset_token" },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
