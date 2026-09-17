import { NextResponse } from "next/server";
import { removeModelFromCombos } from "@/lib/localDb";

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
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error removing model from combos:", error);
    return NextResponse.json({ error: "Failed to remove model from combos" }, { status: 500 });
  }
}
