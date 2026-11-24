import { NextResponse } from "next/server";
import { getComboById, updateCombo } from "@/lib/db/repos/combosRepo";
import {
  fetchLeaderboardModels,
  matchModelsWithLeaderboard,
  validateIntelligenceConfig,
} from "@/lib/services/artificialAnalysis";
import { buildModelsList } from "@/app/api/v1/models/route";
import { resetComboRotation } from "open-sse/services/combo.js";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    if (combo.config?.type !== "intelligence") {
      return NextResponse.json({ error: "This combo is not intelligence-managed" }, { status: 400 });
    }

    const config = validateIntelligenceConfig(combo.config);
    const aaModels = await fetchLeaderboardModels({ forceRefresh: true });

    // Fetch available provider models in 9router. A discovery error is not
    // proof that no configured route matches, so it must never be treated as
    // an empty catalog: leave the combo unchanged and report the failure
    // instead of persisting an empty model list.
    let availableModels;
    try {
      const allModels = await buildModelsList(["llm"], { configuredOnly: true });
      if (!Array.isArray(allModels)) {
        throw new Error("Provider model discovery did not return a catalog");
      }
      availableModels = allModels.filter((m) => m && m.owned_by !== "combo");
    } catch (err) {
      console.warn("[ComboRefresh] Failed to get available models:", err.message);
      return NextResponse.json(
        { success: false, error: "Failed to get available provider models; combo was left unchanged" },
        { status: 502 }
      );
    }

    const { models, details } = matchModelsWithLeaderboard({
      aaModels,
      availableModels,
      ...config,
    });
    if (models.length === 0) {
      const disabledCombo = await updateCombo(
        id,
        {
          models: [],
          config: {
            ...config,
            lastRefreshedAt: new Date().toISOString(),
            matchedDetails: [],
          },
        },
        { expectedUpdatedAt: combo.updatedAt }
      );
      if (!disabledCombo) {
        return NextResponse.json(
          { error: "Combo changed while refreshing; retry the refresh" },
          { status: 409 }
        );
      }
      resetComboRotation(combo.name);
      return NextResponse.json({
        success: true,
        disabled: true,
        combo: disabledCombo,
        newModelsCount: 0,
        details: [],
      });
    }

    const updatedConfig = {
      ...config,
      lastRefreshedAt: new Date().toISOString(),
      matchedDetails: details,
    };

    const updatedCombo = await updateCombo(
      id,
      {
        models,
        config: updatedConfig,
      },
      { expectedUpdatedAt: combo.updatedAt }
    );
    if (!updatedCombo) {
      return NextResponse.json(
        { error: "Combo changed while refreshing; retry the refresh" },
        { status: 409 }
      );
    }

    resetComboRotation(combo.name);

    return NextResponse.json({
      success: true,
      combo: updatedCombo,
      newModelsCount: models.length,
      details,
    });
  } catch (error) {
    console.error("[ComboRefresh] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to refresh combo" },
      { status: 500 }
    );
  }
}
