import { NextResponse } from "next/server";
import { resolvePricingForModel } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const MAX_MODELS = 500;

/**
 * POST /api/pricing/resolve
 * Body: { provider: string, models: string[] }
 * -> { prices: { [model]: { pricing: {input, output, ...} | null, source } } }
 * One round trip for a whole provider page. Same auth as the rest of /api.
 */
export async function POST(request) {
  try {
    let body;
    try { body = await request.json(); } catch { body = null; }
    const { provider, models } = body || {};
    if (typeof provider !== "string" || !provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }
    if (!Array.isArray(models) || models.some((m) => typeof m !== "string")) {
      return NextResponse.json({ error: "models must be an array of strings" }, { status: 400 });
    }
    if (models.length > MAX_MODELS) {
      return NextResponse.json({ error: `at most ${MAX_MODELS} models per request` }, { status: 400 });
    }
    const prices = {};
    for (const model of models) prices[model] = await resolvePricingForModel(provider, model);
    return NextResponse.json({ prices });
  } catch (error) {
    console.error("Error resolving pricing:", error);
    return NextResponse.json({ error: "Failed to resolve pricing" }, { status: 500 });
  }
}
