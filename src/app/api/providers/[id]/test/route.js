import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { requireAdmin } from "@/lib/auth/helpers";
import { testSingleConnection } from "./testUtils.js";

// POST /api/providers/[id]/test - Test connection (admin only, global config)
export async function POST(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const connection = await getProviderConnectionById(id, null);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Test failed" }, { status });
  }
}
