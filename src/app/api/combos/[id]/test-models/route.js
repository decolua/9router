import { NextResponse } from "next/server";
import { getComboById } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";

/**
 * POST /api/combos/[id]/test-models
 * Batch tests all models in a combo (or draft models) to check dead/alive status and latency.
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

    // Warm up with first model to prevent race condition when refreshing provider tokens
    const [first, ...rest] = models;
    const firstResult = await pingModelByKind(first, kind, baseUrl);
    const results = [{ model: first, ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model) => {
          const res = await pingModelByKind(model, kind, baseUrl);
          return { model, ...res };
        })
      );
      results.push(...restResults);
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
    console.error("Error batch testing combo models:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to test combo models" },
      { status: 500 }
    );
  }
}
