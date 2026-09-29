import { NextResponse } from "next/server";
import { clearPoolUnfit } from "../../../../../../../open-sse/services/proxyPoolFitness.js";

// POST /api/proxy-pools/[id]/fitness/clear
export async function POST(req, { params }) {
  try {
    const { id: poolId } = await params;
    if (!poolId || typeof poolId !== "string" || !poolId.trim()) {
      return NextResponse.json({ error: "poolId is required" }, { status: 400 });
    }

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { scope } = body;
    if (!scope) {
      return NextResponse.json(
        { error: "scope is required" },
        { status: 400 }
      );
    }

    const success = await clearPoolUnfit(poolId, scope);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to clear proxy fitness" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, poolId, scope });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to clear proxy fitness" },
      { status: 500 }
    );
  }
}
