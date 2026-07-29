import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearDashboardAuthCookie, getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export async function POST(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const session = token ? await getDashboardAuthSession(token) : null;

  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");

  if (session?.userId) {
    await auditFromRequest(request, {
      action: AuditAction.LOGOUT,
      actorUserId: session.userId,
      actorEmail: session.email,
      targetType: "user",
      targetId: session.userId,
    });
  }

  return NextResponse.json({ success: true });
}
