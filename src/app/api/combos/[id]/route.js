import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { requireAdmin } from "@/lib/auth/helpers";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// GET /api/combos/[id] - Get combo by ID (admin only, global config)
export async function GET(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const combo = await getComboById(id, null);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to fetch combo" }, { status });
  }
}

// PUT /api/combos/[id] - Update combo (admin only, global config)
export async function PUT(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    
    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, - and _" }, { status: 400 });
      }
      
      // Check if name already exists globally (exclude current combo)
      const existing = await getComboByName(body.name, null);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }
    
    const combo = await updateCombo(id, body, null);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    return NextResponse.json(combo);
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to update combo" }, { status });
  }
}

// DELETE /api/combos/[id] - Delete combo (admin only, global config)
export async function DELETE(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const success = await deleteCombo(id, null);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to delete combo" }, { status });
  }
}
