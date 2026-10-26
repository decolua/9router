import { NextResponse } from "next/server";
import { getComboById } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";

/**
 * POST /api/combos/[id]/test-models
 * Tests combo models in sequential order to prevent connection saturation, rate-limits, and timeouts.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    let models = [];
    let kind = body.kind || "llm";

    if (Array.isArray(body.models) && body.models.length > 0) {
      models = body.models;
    } else if (id && id !== "draft") {
      const combo = await getComboById(id);
      if (!combo) {
        return NextResponse.json({ error: "Combo not found" }, { status: 404 });
      }
      models = combo.models || [];
      if (combo.kind) kind = combo.kind;
    }

    if (!models || models.length === 0) {
      return NextResponse.json({ error: "No models in combo to test" }, { status: 400 });
    }

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
    const results = [];

    // Test sequentially one by one to avoid connection saturation and timeouts
    for (const model of models) {
      try {
        const res = await pingModelByKind(model, kind, baseUrl);
        results.push({ model, ...res });
      } catch (err) {
        results.push({
          model,
          ok: false,
          latencyMs: 0,
          error: err?.message || "Model test aborted or timed out",
          status: 500,
        });
      }
    }

    const aliveCount = results.filter((r) => r.ok).length;
    const deadCount = results.length - aliveCount;

    return NextResponse.json({
      comboId: id,
      summary: {
        total: results.length,
        alive: aliveCount,
        dead: deadCount,
      },
      results,
    });
  } catch (error) {
    console.error("Error testing combo models:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to test combo models" },
      { status: 500 }
    );
  }
}
