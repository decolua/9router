import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

const LEGACY_MIRROR_FIELDS = new Set([
  "testStatus",
  "lastError",
  "lastErrorType",
  "lastErrorAt",
  "rateLimitedUntil",
  "errorCode",
  "lastTested",
]);

function stripLegacyMirrorFields(record = {}) {
  return Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !LEGACY_MIRROR_FIELDS.has(key))
  );
}

// GET /api/providers/client - List all connections for client (includes sensitive fields for sync)
export async function GET() {
  try {
    const connections = await getProviderConnections();
    
    // Include sensitive fields for sync to cloud (only accessible from same origin)
    const clientConnections = connections.map(c => stripLegacyMirrorFields({
      ...c,
      // Don't hide sensitive fields here since this is for internal sync
    }));

    return NextResponse.json({ connections: clientConnections });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
