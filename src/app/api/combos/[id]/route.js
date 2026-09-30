import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName, getCombos } from "@/lib/localDb";
import { getStudioModels } from "@/lib/db/repos/modelEditorRepo.js";
import { studioReachesCombo, describeComboCycle } from "@/shared/utils/studioComboGuard.js";
import { resetComboRotation } from "open-sse/services/combo.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// A combo may declare its own context window; 0 keeps it on auto (largest member).
const MAX_CUSTOM_CONTEXT = 100_000_000;

function readContextWindow(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_CUSTOM_CONTEXT);
}

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
    
    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }
      
      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }
    
    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const nextName = typeof body.name === "string" && body.name ? body.name : prev?.name;
    const nextMembers = Array.isArray(body.models)
      ? body.models.map((m) => String(m ?? "").trim()).filter(Boolean)
      : null;
    if (nextName && nextMembers) {
      const [combos, studios] = await Promise.all([
        getCombos().catch(() => []),
        getStudioModels().catch(() => []),
      ]);
      const targets = new Map(studios.map((s) => [s.callName, s.targetModel]));
      const draftByName = new Map(combos.map((c) => [c.name, c.models || []]));
      if (prev?.name && prev.name !== nextName) draftByName.delete(prev.name);
      draftByName.set(nextName, nextMembers);
      for (const member of nextMembers) {
        if (member.includes("/") || !targets.has(member)) continue;
        const chain = studioReachesCombo({ studioName: member, comboName: nextName, combosByName: draftByName, studioTargets: targets });
        if (chain) {
          return NextResponse.json({ error: describeComboCycle(chain) }, { status: 400 });
        }
      }
    }
    const combo = await updateCombo(id, {
      ...body,
      ...(body.contextWindow !== undefined ? { contextWindow: readContextWindow(body.contextWindow) } : {}),
    });
    
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
