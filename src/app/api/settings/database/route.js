import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { hasValidCliToken, hasValidToken } from "@/dashboardGuard";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// Validate CLI token AND require JWT session for browser requests.
// CLI requests: valid CLI token + password verification (second factor).
// Browser requests: valid JWT session + password verification.
async function checkAuth(request, password) {
  const cliTokenValid = await hasValidCliToken(request);
  const jwtValid = await hasValidToken(request);

  // CLI path: require valid CLI token AND password verification
  if (cliTokenValid) {
    if (!password || !(await verifyDashboardPassword(password))) {
      return false;
    }
    return true;
  }

  // Browser path: require valid JWT session AND password verification
  if (jwtValid) {
    if (!password || !(await verifyDashboardPassword(password))) {
      return false;
    }
    return true;
  }

  return false;
}

export async function GET(request) {
  try {
    const password = request.headers.get(PASSWORD_HEADER);
    if (!(await checkAuth(request, password))) {
      return NextResponse.json({ error: "Unauthorized: CLI token + password or JWT session + password required" }, { status: 401 });
    }
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, ...payload } = await request.json();
    if (!(await checkAuth(request, password))) {
      return NextResponse.json({ error: "Unauthorized: CLI token + password or JWT session + password required" }, { status: 401 });
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
