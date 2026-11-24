import { reportRoute } from "@/lib/usage/reportRoute.js";

export const GET = reportRoute((reports, range) =>
  Response.json(reports.analytics(range), { headers: { "Cache-Control": "no-store" } }));
