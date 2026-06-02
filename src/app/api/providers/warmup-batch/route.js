import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { warmupSingleConnection } from "../[id]/test/testUtils.js";

// POST /api/providers/warmup-batch - Warmup multiple connections
export async function POST(request) {
  try {
    const body = await request.json();
    const { connectionIds } = body;

    if (!connectionIds || !Array.isArray(connectionIds)) {
      return NextResponse.json(
        { error: "connectionIds array is required" },
        { status: 400 },
      );
    }

    if (connectionIds.length === 0) {
      return NextResponse.json({
        results: [],
        summary: { total: 0, passed: 0, failed: 0 },
        testedAt: new Date().toISOString(),
      });
    }

    const results = [];
    for (const id of connectionIds) {
      try {
        const conn = await getProviderConnectionById(id);
        if (!conn) {
          results.push({
            connectionId: id,
            valid: false,
            error: "Connection not found",
            testedAt: new Date().toISOString(),
          });
          continue;
        }

        const data = await warmupSingleConnection(id);
        results.push({
          provider: conn.provider,
          connectionId: id,
          connectionName: conn.name || conn.email || conn.provider,
          valid: data.valid,
          latencyMs: data.latencyMs || 0,
          error: data.error || null,
          testedAt: data.testedAt || new Date().toISOString(),
        });
      } catch (error) {
        results.push({
          connectionId: id,
          valid: false,
          error: error.message,
          testedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      results,
      testedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        passed: results.filter((r) => r.valid).length,
        failed: results.filter((r) => !r.valid).length,
      },
    });
  } catch (error) {
    console.log("Error in batch warmup:", error);
    return NextResponse.json({ error: "Batch warmup failed" }, { status: 500 });
  }
}
