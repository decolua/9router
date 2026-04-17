import { NextResponse } from "next/server";
import { batchUpdateProviderConnections } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// PATCH /api/providers/batch - Batch update multiple connections
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { connectionIds, isActive } = body;

    if (!Array.isArray(connectionIds) || connectionIds.length === 0) {
      return NextResponse.json({ error: "connectionIds array is required" }, { status: 400 });
    }

    if (isActive === undefined) {
      return NextResponse.json({ error: "isActive is required" }, { status: 400 });
    }

    const result = await batchUpdateProviderConnections(connectionIds, { isActive });

    return NextResponse.json({
      succeeded: result.succeeded,
      failed: result.failed,
      total: connectionIds.length
    });
  } catch (error) {
    console.log("Error batch updating providers:", error);
    return NextResponse.json({ error: "Failed to batch update providers" }, { status: 500 });
  }
}