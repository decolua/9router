import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCombos, createCombo, getComboByName, getSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

// This route mutates routing configuration and is reachable on the public host.
// There is no middleware.js in this app, so nothing else guards it. Same check
// /api/auth/oidc/test uses: honour requireLogin=false for local-only setups,
// otherwise require a valid dashboard session.
async function canEditCombos() {
  const settings = await getSettings();
  if (settings.requireLogin === false) return true;
  const cookieStore = await cookies();
  return await verifyDashboardAuthToken(cookieStore.get("auth_token")?.value);
}

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    if (!(await canEditCombos())) return unauthorized();
    const body = await request.json();
    const { name, models, kind } = body;

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

    const combo = await createCombo({ name, models: models || [], kind: kind || null });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
