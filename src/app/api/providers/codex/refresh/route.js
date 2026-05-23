import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { refreshSelectedCodexConnections } from "@/sse/services/tokenRefresh";

export async function POST(request) {
  try {
    const body = await request.json();
    const connectionIds = Array.isArray(body.connectionIds) ? body.connectionIds : [];

    if (connectionIds.length === 0) {
      return NextResponse.json({ error: "connectionIds is required" }, { status: 400 });
    }

    const connections = await Promise.all(
      connectionIds.map((connectionId) => getProviderConnectionById(connectionId)),
    );

    const codexConnections = connections.filter((connection) => connection && connection.provider === "codex");
    if (codexConnections.length === 0) {
      return NextResponse.json({ error: "No Codex connections found" }, { status: 400 });
    }

    const results = await refreshSelectedCodexConnections(codexConnections);
    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        passed: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
      },
    });
  } catch (error) {
    console.log("Error refreshing Codex connections:", error);
    return NextResponse.json({ error: "Failed to refresh Codex connections" }, { status: 500 });
  }
}
