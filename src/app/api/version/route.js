import pkg from "../../../../package.json" with { type: "json" };
import { getVersionStatus } from "@/lib/update/versionPolicy.js";

export async function GET() {
  const status = await getVersionStatus({ currentVersion: pkg.version });

  return Response.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
