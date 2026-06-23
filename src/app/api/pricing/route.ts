import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { getPricing, updatePricing, resetPricing, resetAllPricing } from "@/lib/localDb.js";

/**
 * GET /api/pricing
 * Get current pricing configuration (merged user + defaults)
 */
export async function GET() {
  try {
    const pricing = await getPricing();
    return NextResponse.json(pricing);
  } catch (error) {
    console.error("Error fetching pricing:", error);
    return NextResponse.json(
      { error: "Failed to fetch pricing" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/pricing
 * Update pricing configuration
 * Body: { provider: { model: { input: number, output: number, cached: number, ... } } }
 */
export async function PATCH(request: NextRequest) {
  try {
    const parsed: JsonValue = await request.json();

    // Validate body structure
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Invalid pricing data format" },
        { status: 400 }
      );
    }
    const body: Record<string, JsonValue> = { ...parsed };

    // Validate pricing structure
    for (const [provider, models] of Object.entries(body)) {
      if (!models || typeof models !== "object" || Array.isArray(models)) {
        return NextResponse.json(
          { error: `Invalid pricing for provider: ${provider}` },
          { status: 400 }
        );
      }

      for (const [model, pricing] of Object.entries(models as Record<string, JsonValue>)) {
        if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
          return NextResponse.json(
            { error: `Invalid pricing for model: ${provider}/${model}` },
            { status: 400 }
          );
        }

        // Validate pricing fields
        const validFields = ["input", "output", "cached", "reasoning", "cache_creation"];
        for (const [key, value] of Object.entries(pricing as Record<string, JsonValue>)) {
          if (!validFields.includes(key)) {
            return NextResponse.json(
              { error: `Invalid pricing field: ${key} for ${provider}/${model}` },
              { status: 400 }
            );
          }
          if (typeof value !== "number" || isNaN(value) || value < 0) {
            return NextResponse.json(
              { error: `Invalid pricing value for ${key} in ${provider}/${model}: must be non-negative number` },
              { status: 400 }
            );
          }
        }
      }
    }

    const updatedPricing = await updatePricing(body as Record<string, Record<string, JsonValue>>);
    return NextResponse.json(updatedPricing);
  } catch (error) {
    console.error("Error updating pricing:", error);
    return NextResponse.json(
      { error: "Failed to update pricing" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/pricing
 * Reset pricing to defaults
 * Query params: ?provider=xxx&model=yyy (optional)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");

    if (provider && model) {
      // Reset specific model
      await resetPricing(provider, model);
    } else if (provider) {
      // Reset entire provider
      await resetPricing(provider);
    } else {
      // Reset all pricing
      await resetAllPricing();
    }

    const pricing = await getPricing();
    return NextResponse.json(pricing);
  } catch (error) {
    console.error("Error resetting pricing:", error);
    return NextResponse.json(
      { error: "Failed to reset pricing" },
      { status: 500 }
    );
  }
}
