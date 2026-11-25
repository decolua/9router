import { publicText } from "../../shared/utils/keyOwnership.js";
import { requireDashboardAdmin } from "@/dashboardGuard";
import { getUsageReports } from "@/lib/db/index.js";
import { parseUsageRange, UsageInputError } from "./range.js";

export function reportRoute(render) {
  return async request => {
    const denied = await requireDashboardAdmin(request);
    if (denied) return denied;
    try {
      const params = new URL(request.url).searchParams;
      const range = parseUsageRange(params);
      if (params.has("project")) {
        const project = publicText(params.get("project"), 120);
        if (!project || params.getAll("project").length !== 1) throw new UsageInputError("Invalid project filter");
        range.project = project;
      }
      return render(await getUsageReports(), range, params);
    } catch (error) {
      const invalid = error instanceof UsageInputError;
      if (!invalid) console.error("[usage] Report query failed", error.name);
      return Response.json({ error: invalid ? error.message : "Could not generate usage report" },
        { status: invalid ? error.status : 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}
