import { NextResponse } from "next/server";
import { getPricing, getSettings, updatePricing, resetPricing, resetAllPricing, updateSettings } from "@/lib/localDb.js";
import { getDefaultPricing, getPricingForModel as getDefaultPricingForModel } from "open-sse/providers/pricing.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

const EMPTY_PRICING = { input: 0, output: 0, cached: 0, cache_creation: 0, reasoning: 0 };
const RATE_FIELDS = Object.keys(EMPTY_PRICING);

function buildPricingCatalog(pricing, deletedPricingModels = []) {
  const deleted = new Set(deletedPricingModels);
  const pairs = new Map();
  const add = (provider, model) => {
    if (!provider || !model) return;
    pairs.set(`${provider}\u0000${model}`, { provider, model });
  };
  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    for (const model of models || []) add(provider, typeof model === "string" ? model : model?.id);
  }
  for (const [provider, models] of Object.entries(pricing || {})) {
    for (const model of Object.keys(models || {})) add(provider, model);
  }
  return [...pairs.values()]
  .filter(({ provider, model }) => !deleted.has(`${provider}\u0000${model}`))
  .map(({ provider, model }) => ({
    provider,
    model,
    pricing: {
      ...EMPTY_PRICING,
      ...(getDefaultPricingForModel(provider, model) || {}),
      ...(pricing?.[provider]?.[model] || {}),
      peakEnabled: pricing?.[provider]?.[model]?.peakEnabled === true,
      peakWindows: pricing?.[provider]?.[model]?.peakWindows || "",
      peakPricing: { ...EMPTY_PRICING, ...(pricing?.[provider]?.[model]?.peakPricing || {}) },
      offPeakPricing: { ...EMPTY_PRICING, ...(pricing?.[provider]?.[model]?.offPeakPricing || {}) },
    },
  })).sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}

/**
 * GET /api/pricing
 * Get current pricing configuration (merged user + defaults)
 */
export async function GET() {
  try {
    const [pricing, settings] = await Promise.all([getPricing(), getSettings()]);
    return NextResponse.json({ items: buildPricingCatalog(pricing, settings.deletedPricingModels) });
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
export async function PATCH(request) {
  try {
    const body = await request.json();

    // Validate body structure
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid pricing data format" },
        { status: 400 }
      );
    }

    // Validate pricing structure
    for (const [provider, models] of Object.entries(body)) {
      if (typeof models !== "object" || models === null) {
        return NextResponse.json(
          { error: `Invalid pricing for provider: ${provider}` },
          { status: 400 }
        );
      }

      for (const [model, pricing] of Object.entries(models)) {
        if (typeof pricing !== "object" || pricing === null) {
          return NextResponse.json(
            { error: `Invalid pricing for model: ${provider}/${model}` },
            { status: 400 }
          );
        }

        // Validate pricing fields
        const validFields = [...RATE_FIELDS, "peakEnabled", "peakWindows", "peakPricing", "offPeakPricing"];
        for (const [key, value] of Object.entries(pricing)) {
          if (!validFields.includes(key)) {
            return NextResponse.json(
              { error: `Invalid pricing field: ${key} for ${provider}/${model}` },
              { status: 400 }
            );
          }
          if (RATE_FIELDS.includes(key) && (typeof value !== "number" || isNaN(value) || value < 0)) {
            return NextResponse.json(
              { error: `Invalid pricing value for ${key} in ${provider}/${model}: must be non-negative number` },
              { status: 400 }
            );
          }
          if (key === "peakEnabled" && typeof value !== "boolean") {
            return NextResponse.json({ error: `Invalid peak pricing switch for ${provider}/${model}` }, { status: 400 });
          }
          if (key === "peakWindows" && typeof value !== "string") {
            return NextResponse.json({ error: `Invalid peak pricing windows for ${provider}/${model}` }, { status: 400 });
          }
          if ((key === "peakPricing" || key === "offPeakPricing") && (typeof value !== "object" || value === null || Object.entries(value).some(([field, rate]) => !RATE_FIELDS.includes(field) || typeof rate !== "number" || isNaN(rate) || rate < 0))) {
            return NextResponse.json({ error: `Invalid ${key} for ${provider}/${model}` }, { status: 400 });
          }
        }
      }
    }

    const settings = await getSettings();
    const restored = new Set(settings.deletedPricingModels || []);
    for (const [provider, models] of Object.entries(body)) {
      for (const model of Object.keys(models)) restored.delete(`${provider}\u0000${model}`);
    }
    const [updatedPricing] = await Promise.all([
      updatePricing(body),
      updateSettings({ deletedPricingModels: [...restored] }),
    ]);
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
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    let requestedModels = [];
    try {
      const body = await request.json();
      requestedModels = Array.isArray(body?.models) ? body.models : [];
    } catch {}

    if (requestedModels.length || (provider && model)) {
      const models = requestedModels.length ? requestedModels : [{ provider, model }];
      const validModels = models.filter((item) => item?.provider && item?.model);
      const settings = await getSettings();
      const deleted = new Set(settings.deletedPricingModels || []);
      for (const item of validModels) {
        await resetPricing(item.provider, item.model);
        deleted.add(`${item.provider}\u0000${item.model}`);
      }
      await updateSettings({ deletedPricingModels: [...deleted] });
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

/**
 * GET /api/pricing/defaults
 * Get default pricing configuration
 */
export async function GET_DEFAULTS() {
  try {
    const defaultPricing = getDefaultPricing();
    return NextResponse.json(defaultPricing);
  } catch (error) {
    console.error("Error fetching default pricing:", error);
    return NextResponse.json(
      { error: "Failed to fetch default pricing" },
      { status: 500 }
    );
  }
}
