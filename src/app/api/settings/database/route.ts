import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

export async function GET(request: NextRequest) {
  try {
    const isCliRequest = Boolean(request.headers.get(CLI_TOKEN_HEADER));
    if (!isCliRequest && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed: JsonValue = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { password, ...payload } = parsed;
    const passwordStr = typeof password === "string" ? password : null;

    const isCliRequest = Boolean(request.headers.get(CLI_TOKEN_HEADER));
    if (!isCliRequest && !(await verifyDashboardPassword(passwordStr))) {
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
    const message = error instanceof Error ? error.message : "Failed to import database";
    console.log("Error importing database:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
