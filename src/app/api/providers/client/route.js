import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { requireAdmin } from "@/lib/auth/helpers";

// GET /api/providers/client - List all connections for client (admin only, includes sensitive fields for sync)
export async function GET(request) {
  try {
    await requireAdmin(request);
    const connections = await getProviderConnections({}, null);
    
    // Include sensitive fields for sync to cloud (only accessible from same origin)
    const clientConnections = connections.map(c => ({
      ...c,
      // Don't hide sensitive fields here since this is for internal sync
    }));

    return NextResponse.json({ connections: clientConnections });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to fetch providers" }, { status });
  }
}
