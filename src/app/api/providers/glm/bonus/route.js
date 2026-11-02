import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getZCodeClaimablePlans, claimZCodePlan } from "@/lib/services/zcodeClaimService.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/providers/glm/bonus
 * Lists available promotional plans for connected ZCode / GLM accounts.
 */
export async function GET(request) {
  try {
    const connections = await getProviderConnections({ provider: "glm" });
    if (!connections || connections.length === 0) {
      return NextResponse.json({
        ok: true,
        hasConnectedAccount: false,
        plans: [],
        message: "No connected ZCode / GLM account found.",
      });
    }

    const results = [];
    for (const conn of connections) {
      // Find session JWT or token
      const token = conn.providerSpecificData?.zcodeJwtToken || conn.apiKey || conn.accessToken;
      if (!token) continue;

      const deviceId = conn.providerSpecificData?.machineId || null;
      const res = await getZCodeClaimablePlans(token, deviceId);
      if (res.ok && res.plans.length > 0) {
        results.push({
          connectionId: conn.id,
          accountName: conn.name || conn.email || "ZCode Account",
          plans: res.plans,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      hasConnectedAccount: true,
      available: results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to check ZCode bonuses" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/providers/glm/bonus
 * Claims a specific promotional plan for a connected ZCode / GLM account.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { connectionId, planId } = body;

    const connections = await getProviderConnections({ provider: "glm" });
    const targetConn = connectionId
      ? connections.find((c) => String(c.id) === String(connectionId))
      : connections[0];

    if (!targetConn) {
      return NextResponse.json(
        { ok: false, error: "ZCode connection not found" },
        { status: 404 }
      );
    }

    const token = targetConn.providerSpecificData?.zcodeJwtToken || targetConn.apiKey || targetConn.accessToken;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "No valid ZCode token on this connection" },
        { status: 400 }
      );
    }

    const deviceId = targetConn.providerSpecificData?.machineId || null;
    const result = await claimZCodePlan(token, planId, deviceId);

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Claim request failed" },
      { status: 500 }
    );
  }
}
