import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { comboKindError, comboModelsError, isComboNameConflict } from "@/lib/db/repos/combosRepo.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate whenever the `name` key is present at all: the repo merges with
    // a spread ({...row, ...body}), so even `name: ""` or `name: 0` used to be
    // written to the row — orphaning the combo (getComboByName never matches).
    if ("name" in body) {
      const { name } = body;
      if (typeof name !== "string" || name.trim() === "") {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      if (!VALID_NAME_REGEX.test(name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    if ("kind" in body) {
      const kindError = comboKindError(body.kind);
      if (kindError) {
        return NextResponse.json({ error: kindError }, { status: 400 });
      }
    }

    if ("models" in body && body.models !== undefined && body.models !== null) {
      const modelsError = comboModelsError(body.models);
      if (modelsError) {
        return NextResponse.json({ error: modelsError }, { status: 400 });
      }
    }

    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    let combo;
    try {
      combo = await updateCombo(id, body);
    } catch (error) {
      // Same TOCTOU shape as POST /api/combos: the by-name pre-check is not
      // transactional, so a concurrent rename can win first and the UNIQUE
      // index rejects ours. That is a 400, not a 500.
      if (isComboNameConflict(error)) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
      throw error;
    }
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
