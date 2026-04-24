import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

// GET /api/providers/client - List all connections for client (includes sensitive fields for sync)
export async function GET(): Promise<NextResponse> {
  try {
    const connections = await getProviderConnections();
    
    // Include sensitive fields for sync to cloud (only accessible from same origin)
    const clientConnections = connections.map((c: any) => ({
      ...c,
      // Don't hide sensitive fields here since this is for internal sync
    }));

    return NextResponse.json({ connections: clientConnections });
  } catch (error: any) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
