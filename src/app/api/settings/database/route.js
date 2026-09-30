import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb, getDbSummary } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { configureTelegramBackup } from "@/shared/services/telegramBackup";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isSummary = searchParams.get("summary") === "true";

    if (!isSummary && !isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    if (isSummary) {
      const summary = await getDbSummary();
      return NextResponse.json(summary);
    }

    const sectionsParam = searchParams.get("sections");
    const options = sectionsParam ? sectionsParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const payload = await exportDb(options);
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, ...payload } = await request.json();
    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
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

    // The import may have replaced the auto-backup config/status (full backups
    // carry the autoBackup KV scope). Re-arm the scheduler against whatever is
    // now stored so the schedule survives imports; fails open when disabled.
    try {
      await configureTelegramBackup();
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to reschedule auto backup:", err.message);
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
