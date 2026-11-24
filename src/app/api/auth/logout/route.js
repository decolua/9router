import { audit } from "@/lib/observability/audit";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearDashboardAuthCookie } from "@/lib/auth/dashboardSession";

export async function POST(request) {
  const cookieStore = await cookies();
  await audit(request, "logout");
  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
