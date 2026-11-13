import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { buildModelsList } from "@/app/api/v1/models/route";
import {
  fetchLeaderboardModels,
  matchModelsWithLeaderboard,
  validateIntelligenceConfig,
} from "@/lib/services/artificialAnalysis";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind, config } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    let comboModels = Array.isArray(models) ? models : [];
    let comboConfig = config || null;
    if (config?.type === "intelligence") {
      comboConfig = validateIntelligenceConfig(config);
      const aaModels = await fetchLeaderboardModels({ forceRefresh: true });
      const availableModels = (await buildModelsList(["llm"], { configuredOnly: true })).filter((model) => model?.owned_by !== "combo");
      const matched = matchModelsWithLeaderboard({ ...comboConfig, aaModels, availableModels });
      if (matched.models.length === 0) {
        return NextResponse.json({ error: "No configured provider models match this intelligence range" }, { status: 400 });
      }
      comboModels = matched.models;
      comboConfig = {
        ...comboConfig,
        lastRefreshedAt: new Date().toISOString(),
        matchedDetails: matched.details,
      };
    }

    const combo = await createCombo({ name, models: comboModels, kind: kind || null, config: comboConfig });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
