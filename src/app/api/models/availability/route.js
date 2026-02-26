import { NextResponse } from "next/server";
import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { isAccountUnavailable } from "open-sse/services/accountFallback.js";

/**
 * GET /api/models/availability
 * Returns availability status of all models across all provider connections
 */
export async function GET() {
  try {
    const connections = await getProviderConnections();
    
    const models = [];
    let unavailableCount = 0;

    for (const conn of connections) {
      // Skip disabled connections
      if (conn.isActive === false) continue;

      const isCooldown = isAccountUnavailable(conn.rateLimitedUntil);
      
      let status = "available";
      if (isCooldown) {
        status = "cooldown";
        unavailableCount++;
      } else if (conn.testStatus === "unavailable" || conn.testStatus === "error") {
        status = "unavailable";
        unavailableCount++;
      }

      // Add entry for this connection (representing its models)
      models.push({
        provider: conn.provider,
        model: conn.name || conn.provider, // Use connection name as model identifier
        connectionId: conn.id,
        status,
        rateLimitedUntil: conn.rateLimitedUntil || null,
        lastError: conn.lastError || null,
      });
    }

    return NextResponse.json({
      models,
      unavailableCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching model availability:", error);
    return NextResponse.json(
      { error: "Failed to fetch model availability" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/models/availability
 * Handles actions like clearing cooldowns for specific models/connections
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action, provider, model, connectionId } = body;

    if (action === "clearCooldown") {
      // Find the connection to clear
      const connections = await getProviderConnections();
      const targetConnection = connections.find(
        (c) =>
          (connectionId && c.id === connectionId) ||
          (provider && c.provider === provider && (c.name === model || c.provider === model))
      );

      if (!targetConnection) {
        return NextResponse.json(
          { error: "Connection not found" },
          { status: 404 }
        );
      }

      // Clear cooldown by removing rateLimitedUntil and resetting backoff
      await updateProviderConnection(targetConnection.id, {
        rateLimitedUntil: null,
        backoffLevel: 0,
        testStatus: "active",
        lastError: null,
        lastErrorAt: null,
      });

      return NextResponse.json({
        success: true,
        message: "Cooldown cleared",
        connectionId: targetConnection.id,
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error handling availability action:", error);
    return NextResponse.json(
      { error: "Failed to process action" },
      { status: 500 }
    );
  }
}
