import { NextResponse } from "next/server";
import { resetDb } from "@/lib/db/index.js";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

// Path is under /api/settings/database → already in dashboardGuard's
// ALWAYS_PROTECTED list (JWT or CLI token required). This route adds:
//   1. an environment kill-switch (off in production unless opted in)
//   2. dashboard-password re-auth (same as export/import)
//   3. an explicit { confirm: "RESET" } body

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

function resetEnabled() {
  if (process.env.ALLOW_DB_RESET === "true") return true;
  return process.env.NODE_ENV !== "production";
}

// POST /api/settings/database/reset
// body: { password?, confirm: "RESET", keepSettings?: boolean }
export async function POST(request) {
  try {
    if (!resetEnabled()) {
      return NextResponse.json(
        {
          error:
            "Database reset is disabled. Set ALLOW_DB_RESET=true to enable " +
            "(allowed automatically only when NODE_ENV !== 'production').",
        },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { password, confirm, keepSettings } = body;

    if (
      !isCliRequest(request) &&
      !(await verifyDashboardPassword(password ?? request.headers.get(PASSWORD_HEADER)))
    ) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    if (confirm !== "RESET") {
      return NextResponse.json(
        { error: 'Confirmation required — send { "confirm": "RESET" } in the body.' },
        { status: 400 },
      );
    }

    const result = await resetDb({ keepSettings: keepSettings === true });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.log("Error resetting database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to reset database" },
      { status: 500 },
    );
  }
}
