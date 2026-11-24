import { requireDashboardAdmin } from "@/dashboardGuard";
import { providerHealth } from "@/lib/observability/providerHealth.js";

export async function GET(request) {
  const denied = await requireDashboardAdmin(request);
  if (denied) return denied;
  return Response.json({ connections: await providerHealth() }, { headers: { "Cache-Control": "no-store" } });
}
