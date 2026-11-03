import { NextResponse } from "next/server";
import { getProviderConnections, getProviderConnectionById } from "@/models";
import {
  isWebSessionConnection,
  validateAndRefreshWebConnection,
  runBackgroundCookieManagerTick,
} from "@/sse/services/backgroundCookieManager.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/web-session/check
 * Trigger proactive check and status update for web session cookies.
 * Optional JSON body: { connectionId: string }
 */
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty or no body is fine
    }

    const { connectionId } = body;

    if (connectionId) {
      const connection = await getProviderConnectionById(connectionId);
      if (!connection) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }

      if (!isWebSessionConnection(connection)) {
        return NextResponse.json(
          { error: "Connection is not a web session or cookie-based provider" },
          { status: 400 }
        );
      }

      const result = await validateAndRefreshWebConnection(connection);
      return NextResponse.json({
        connectionId,
        valid: result.valid,
        error: result.error || null,
        inconclusive: !!result.inconclusive,
      });
    }

    // Trigger tick across all due web connections in background
    runBackgroundCookieManagerTick().catch((err) => {
      console.log("[BackgroundCookieManager] On-demand tick error:", err.message);
    });

    const allConnections = await getProviderConnections({ isActive: true });
    const webConnections = allConnections.filter(isWebSessionConnection);

    return NextResponse.json({
      message: "Web session check triggered",
      totalWebConnections: webConnections.length,
    });
  } catch (error) {
    console.log("Error checking web sessions:", error);
    return NextResponse.json({ error: "Failed to check web sessions" }, { status: 500 });
  }
}
