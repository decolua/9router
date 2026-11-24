import { audit, auditActor } from "@/lib/observability/audit";
import { cookies } from "next/headers";
import { requireDashboardAdmin } from "@/dashboardGuard";
import { clearDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { updateSettings } from "@/lib/db/repos/settingsRepo.js";

export async function POST(request) {
  const denied = await requireDashboardAdmin(request);
  if (denied) return denied;
  const identity = await auditActor(request);
  await updateSettings({}, { revokeSessions: true });
  await audit(request, "session.revoke", { identity });
  clearDashboardAuthCookie(await cookies());
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
