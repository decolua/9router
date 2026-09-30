import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { getStudioModels } from "@/lib/db/repos/modelEditorRepo.js";
import { studioReachesCombo, describeComboCycle } from "@/shared/utils/studioComboGuard.js";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// A combo may declare its own context window; 0 keeps it on auto (largest member).
const MAX_CUSTOM_CONTEXT = 100_000_000;

function readContextWindow(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_CUSTOM_CONTEXT);
}

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

    // A combo member may name a studio (custom) model, but a studio that
    // routes back into this combo would loop combo -> studio -> combo, so the
    // combo name may not be reachable from any named studio member.
    const memberNames = Array.isArray(models) ? models.map((m) => String(m ?? "").trim()).filter(Boolean) : [];
    if (memberNames.length) {
      const [combos, studios] = await Promise.all([
        getCombos().catch(() => []),
        getStudioModels().catch(() => []),
      ]);
      const targets = new Map(studios.map((s) => [s.callName, s.targetModel]));
      const draftByName = new Map(combos.map((c) => [c.name, c.models || []]));
      draftByName.set(name, memberNames);
      for (const member of memberNames) {
        if (member.includes("/") || !targets.has(member)) continue;
        const chain = studioReachesCombo({ studioName: member, comboName: name, combosByName: draftByName, studioTargets: targets });
        if (chain) {
          return NextResponse.json({ error: describeComboCycle(chain) }, { status: 400 });
        }
      }
    }

    const combo = await createCombo({
      name,
      models: models || [],
      kind: kind || null,
      contextWindow: readContextWindow(body.contextWindow),
    });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
