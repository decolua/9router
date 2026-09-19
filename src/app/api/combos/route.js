import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { comboKindError, comboModelsError, isComboNameConflict } from "@/lib/db/repos/combosRepo.js";

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
    const { name, models, kind } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // `models` is consumed everywhere as an array (.length/.map/.filter on it);
    // a bare string/object/number silently poisons routing for this combo.
    if (models !== undefined && models !== null) {
      const modelsError = comboModelsError(models);
      if (modelsError) {
        return NextResponse.json({ error: modelsError }, { status: 400 });
      }
    }

    // kind gates which /v1 surface serves the combo (v1/models, webRouting,
    // media-providers pages) — only the values those readers check for.
    if ("kind" in body) {
      const kindError = comboKindError(kind);
      if (kindError) {
        return NextResponse.json({ error: kindError }, { status: 400 });
      }
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    let combo;
    try {
      combo = await createCombo({ name, models: models || [], kind: kind || null });
    } catch (error) {
      // The pre-check above is not transactional: a concurrent submit can pass
      // it and win the INSERT, so the UNIQUE index (schema.js combos.name) is
      // the real authority. Report that race as the same 400, not a 500.
      if (isComboNameConflict(error)) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
