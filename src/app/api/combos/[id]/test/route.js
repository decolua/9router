import { NextResponse } from "next/server";
import { getComboById, getSettings } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { getRotatedModels } from "open-sse/services/combo.js";

/**
 * POST /api/combos/[id]/test - Test combo fallback execution order
 * Accepts JSON body: { prompt?: string, mode?: "fallback" | "all" }
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { prompt = null, mode = "fallback" } = body;

    let combo = await getComboById(id);
    if (!combo && body.models && Array.isArray(body.models)) {
      combo = {
        id: id || "draft",
        name: body.name || "Draft Combo",
        kind: body.kind || "llm",
        models: body.models,
      };
    }

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    const models = combo.models || [];
    if (models.length === 0) {
      return NextResponse.json({ error: "Combo has no models configured" }, { status: 400 });
    }

    const settings = await getSettings();
    const comboStrategies = settings.comboStrategies || {};
    const comboConfig = comboStrategies[combo.name] || {};
    const strategy = comboConfig.fallbackStrategy || settings.comboStrategy || "fallback";

    let orderedModels = [...models];
    if (strategy === "round-robin") {
      orderedModels = getRotatedModels(models, combo.name, "round-robin", comboConfig.stickyLimit || 1);
    }

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
    const steps = [];
    let comboStatus = "failed";
    let servingModel = null;
    let servedStepIndex = null;

    for (let i = 0; i < orderedModels.length; i++) {
      const modelStr = orderedModels[i];
      const pingRes = await pingModelByKind(modelStr, combo.kind || "llm", baseUrl, prompt);

      if (pingRes.ok) {
        steps.push({
          index: i + 1,
          model: modelStr,
          ok: true,
          status: pingRes.status || 200,
          latencyMs: pingRes.latencyMs,
          error: null,
          preview: pingRes.preview || null,
          fallbackTriggered: false,
          servedRequest: true,
          skipped: false,
        });

        if (comboStatus === "failed") {
          comboStatus = "success";
          servingModel = modelStr;
          servedStepIndex = i + 1;
        }

        if (mode === "fallback") {
          // Fill remaining models as skipped in fallback mode
          for (let j = i + 1; j < orderedModels.length; j++) {
            steps.push({
              index: j + 1,
              model: orderedModels[j],
              ok: false,
              skipped: true,
              reason: `Skipped: Fallback satisfied by step #${i + 1} (${modelStr})`,
            });
          }
          break;
        }
      } else {
        steps.push({
          index: i + 1,
          model: modelStr,
          ok: false,
          status: pingRes.status || 500,
          latencyMs: pingRes.latencyMs,
          error: pingRes.error || "Model ping failed",
          preview: null,
          fallbackTriggered: true,
          servedRequest: false,
          skipped: false,
        });
      }
    }

    return NextResponse.json({
      comboId: combo.id,
      comboName: combo.name,
      kind: combo.kind || "llm",
      strategy,
      mode,
      comboStatus,
      servingModel,
      servedStepIndex,
      totalLatencyMs: steps.reduce((acc, s) => acc + (s.latencyMs || 0), 0),
      steps,
    });
  } catch (error) {
    console.log("Error testing combo:", error);
    return NextResponse.json({ error: "Failed to test combo execution" }, { status: 500 });
  }
}
