import { NextResponse } from "next/server";
import { removeModelFromCombos } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";

export const dynamic = "force-dynamic";

// POST /api/combos/remove-model  body: { candidates: string[] }
//
// `candidates` is every name form one provider model may be stored under in a
// combo; the caller builds it with modelCandidates() so both sides agree.
export async function POST(request) {
  try {
    const body = await request.json();
    const candidates = Array.isArray(body?.candidates)
      ? body.candidates.filter((value) => typeof value === "string" && value.length > 0)
      : [];

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "candidates must be a non-empty array of strings" },
        { status: 400 }
      );
    }

    const combos = await removeModelFromCombos(candidates);
    // PUT/DELETE /api/combos/[id] already invalidate rotation when a combo
    // changes; pruning members must do the same, or strategy/sticky state
    // keyed by combo name keeps pointing at a member list that no longer
    // exists (cosmetic for round-robin's index % length, divergent otherwise).
    for (const combo of combos) resetComboRotation(combo.name);
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error removing model from combos:", error);
    return NextResponse.json({ error: "Failed to remove model from combos" }, { status: 500 });
  }
}
