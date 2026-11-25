import { requireDashboardAdmin } from "@/dashboardGuard";
import { audit } from "@/lib/observability/audit";
import { updateDebugCaptureWindow } from "@/lib/db/index.js";

async function change(request, enable) {
  const denied = await requireDashboardAdmin(request, { requireCredential: true });
  if (denied) return denied;
  let until = null;
  if (enable) {
    const body = await request.json().catch(() => null);
    if (!Number.isInteger(body?.minutes) || body.minutes < 1 || body.minutes > 1440)
      return Response.json({ error: "minutes must be an integer from 1 to 1440" }, { status: 400 });
    until = new Date(Date.now() + body.minutes * 60_000).toISOString();
  }
  await updateDebugCaptureWindow(until);
  await audit(request, enable ? "debug.enable" : "debug.disable");
  return Response.json({ debugBodyLoggingUntil: until }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = request => change(request, true);
export const DELETE = request => change(request, false);
