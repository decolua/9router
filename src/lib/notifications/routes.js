import { requireDashboardAdmin } from "../../dashboardGuard.js";
import { getNotificationsRepo } from "@/lib/db/index.js";
import { audit } from "../observability/audit.js";

export const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Authenticate before inspecting any body; never reflect a URL, token or transport exception.
export function adminRoute(handler, action) {
  return async request => {
    const denied = await requireDashboardAdmin(request);
    if (denied) return denied;
    if (request.method !== "GET" && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      return json({ error: "JSON content type required" }, 415);
    let result;
    try {
      const body = request.method === "GET" ? {} : await request.json();
      result = await handler(await getNotificationsRepo(), body, Date.now());
    } catch { result = json({ error: "Invalid notification request" }, 400); }
    if (action) await audit(request, action, { result: result.ok ? "success" : "failure" });
    return result;
  };
}
