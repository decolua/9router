import { NextResponse } from "next/server";
import { createTransferBundle } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

export async function POST(request) {
  try {
    const { password, providerConnectionIds, comboIds } = await request.json();
    const providerSelection = Array.isArray(providerConnectionIds) ? providerConnectionIds : [];
    // Combo-only exports contain no credentials and should remain usable when
    // a dashboard is configured without a password. Provider exports still
    // require the existing dashboard password check.
    if (providerSelection.length > 0 && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    return NextResponse.json(await createTransferBundle({ providerConnectionIds, comboIds }));
  } catch (error) {
    console.log("[Transfer] Export failed:", error.message);
    return NextResponse.json({ error: error.message || "Failed to export selection" }, { status: 400 });
  }
}
