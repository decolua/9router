import { NextResponse } from "next/server";
import { getDistinctModels } from "@/lib/requestDetailsDb";

/**
 * GET /api/usage/models
 * Query parameters: provider (optional) — narrows the list to models served by that provider
 * Returns the unique model ids present in request details, for the usage details filter.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    // DISTINCT column read only — parsing the data blobs would load every row's
    // full request/response JSON (the providers route hit an OOM doing that).
    const models = await getDistinctModels(provider || null);

    return NextResponse.json({ models });
  } catch (error) {
    console.error("[API] Failed to get models:", error);
    return NextResponse.json(
      { error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}
