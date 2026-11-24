import { usageExport } from "@/lib/usage/export.js";
import { reportRoute } from "@/lib/usage/reportRoute.js";

export const GET = reportRoute((reports, range, params) =>
  usageExport(reports, range, params.getAll("format").length === 1 ? params.get("format") : null));
