import { requireDashboardAdmin } from "@/dashboardGuard";
import { listAuditEntries } from "@/lib/db/index.js";

export async function GET(request) {
  const denied = await requireDashboardAdmin(request, { requireCredential: true });
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 25);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)) return Response.json({ error: "Invalid pagination" }, { status: 400 });
  const dates = {};
  for (const name of ["startDate", "endDate"]) {
    if (!params.has(name)) continue;
    const at = Date.parse(params.get(name));
    if (!Number.isFinite(at)) return Response.json({ error: "Invalid date" }, { status: 400 });
    dates[name] = new Date(at).toISOString();
  }
  const rows = await listAuditEntries({ ...dates, action: params.get("action"), page, pageSize });
  return Response.json({ entries: rows.slice(0, pageSize).map(r => ({ ...r, detail: JSON.parse(r.detail) })),
    page, hasNext: rows.length > pageSize }, { headers: { "Cache-Control": "no-store" } });
}
