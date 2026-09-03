import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, getCustomModels, getProviderConnections, getModelAliases } from "@/lib/localDb";
import { createComboCapsResolver, validateComboCaps } from "@/lib/comboCaps";

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
    const { name, models, kind, caps } = body;
    const effectiveModels = models === undefined ? [] : models;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    const [customModels, connections, modelAliases] = await Promise.all([getCustomModels(), getProviderConnections(), getModelAliases()]);
    const capsError = validateComboCaps(caps, effectiveModels, createComboCapsResolver(customModels, connections, modelAliases));
    if (capsError) {
      return NextResponse.json({ error: capsError }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: effectiveModels, kind: kind || null, caps: caps || {} });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
