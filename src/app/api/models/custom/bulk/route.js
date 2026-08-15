import { NextResponse } from "next/server";
import { addCustomModelsBulk } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const MAX_IDS = 500;

// POST /api/models/custom/bulk - add many custom models in one transaction
// Body: { providerAlias, type?, ids: string[] }
export async function POST(request) {
  try {
    const body = await request.json();
    const { providerAlias, type = "llm", ids } = body || {};

    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }

    const cleanIds = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
    if (cleanIds.length === 0) {
      return NextResponse.json({ error: "ids must contain at least one non-empty string" }, { status: 400 });
    }
    if (cleanIds.length > MAX_IDS) {
      return NextResponse.json({ error: `Too many ids (max ${MAX_IDS})` }, { status: 400 });
    }

    const result = await addCustomModelsBulk({ providerAlias, type, ids: cleanIds });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.log("Error bulk-adding custom models:", error);
    return NextResponse.json({ error: "Failed to bulk add custom models" }, { status: 500 });
  }
}
