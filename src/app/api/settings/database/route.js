import { audit, auditActor } from "@/lib/observability/audit";
import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const PASSWORD_HEADER = "x-9r-password";


async function getHandler(request, identity) {
  try {
    if (identity.actor !== "cli" && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const payload = await exportDb();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

async function postHandler(request, identity) {
  try {
    const { password, ...payload } = await request.json();
    if (identity.actor !== "cli" && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}

export async function GET(request) {
  const identity = await auditActor(request);
  const response = await getHandler(request, identity);
  await audit(request, "db.export", { identity, result: response.ok ? "success" : "failure" });
  return response;
}

export async function POST(request) {
  const identity = await auditActor(request);
  const response = await postHandler(request, identity);
  await audit(request, "db.import", { identity, result: response.ok ? "success" : "failure" });
  return response;
}
