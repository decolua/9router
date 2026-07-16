import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { buildExportJson, buildExportTxt } from "@/lib/providerKeysIo";

export const dynamic = "force-dynamic";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

/**
 * GET /api/providers/keys/export?provider=<id>&format=json|txt
 *
 * Returns the provider's API-key / cookie credentials (secrets included).
 * Requires dashboard password re-auth (or CLI token), same as DB export.
 */
export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerRaw = searchParams.get("provider") || searchParams.get("providerId") || "";
    const format = (searchParams.get("format") || "json").toLowerCase();

    if (!providerRaw) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }
    if (format !== "json" && format !== "txt") {
      return NextResponse.json({ error: "format must be json or txt" }, { status: 400 });
    }

    const provider = normalizeProviderId(providerRaw);
    const connections = await getProviderConnections({ provider });

    if (format === "txt") {
      const body = buildExportTxt(provider, connections);
      const filename = `9router-${provider}-keys.txt`;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const payload = buildExportJson(provider, connections);
    const filename = `9router-${provider}-keys.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.log("Error exporting provider keys:", error);
    return NextResponse.json({ error: "Failed to export provider keys" }, { status: 500 });
  }
}
