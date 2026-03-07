import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { requireAdmin } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// GET /api/combos - Get all combos (admin only, global config)
export async function GET(request) {
  try {
    await requireAdmin(request);
    const combos = await getCombos(null);
    return NextResponse.json({ combos });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to fetch combos" }, { status });
  }
}

// POST /api/combos - Create new combo (admin only, global config)
export async function POST(request) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { name, models } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, - and _" }, { status: 400 });
    }

    // Check if name already exists (global)
    const existing = await getComboByName(name, null);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [] }, null);

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to create combo" }, { status });
  }
}
