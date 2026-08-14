import { NextResponse } from "next/server";
import { getProviderModels } from "@/lib/modelsDev/index.js";
import { updatePricing, setCapsOverridesBulk } from "@/lib/db/index.js";
import { getProviderAlias } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

const VALID_TARGETS = ["pricing", "caps"];

// POST /api/models-dev/import
// Body: { provider: "<9router id or alias>", targets?: ["pricing", "caps"] }
// Writes models.dev data as user overrides: pricing → kv scope "pricing"
// (keyed by routed provider alias), caps → kv scope "modelCaps".
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = body?.provider;
    const targets = Array.isArray(body?.targets) && body.targets.length > 0
      ? body.targets.filter((t) => VALID_TARGETS.includes(t))
      : VALID_TARGETS;

    if (!provider) {
      return NextResponse.json({ error: "provider required" }, { status: 400 });
    }
    if (targets.length === 0) {
      return NextResponse.json({ error: "No valid targets; expected pricing and/or caps" }, { status: 400 });
    }

    const alias = getProviderAlias(provider) || provider;
    const result = await getProviderModels([alias, provider]);
    if (!result.modelsDevId || !result.models) {
      return NextResponse.json(
        { error: `Provider ${provider} is not available on models.dev` },
        { status: 404 }
      );
    }

    const response = {
      success: true,
      provider: alias,
      modelsDevId: result.modelsDevId,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
    };

    if (targets.includes("pricing")) {
      const pricingModels = {};
      for (const [modelId, model] of Object.entries(result.models)) {
        if (model.pricing && (typeof model.pricing.input === "number" || typeof model.pricing.output === "number")) {
          pricingModels[modelId] = model.pricing;
        }
      }
      if (Object.keys(pricingModels).length > 0) {
        await updatePricing({ [alias]: pricingModels });
      }
      response.pricing = { imported: Object.keys(pricingModels).length };
    }

    if (targets.includes("caps")) {
      const capsEntries = {};
      for (const [modelId, model] of Object.entries(result.models)) {
        capsEntries[modelId] = model.caps;
      }
      if (Object.keys(capsEntries).length > 0) {
        await setCapsOverridesBulk(alias, capsEntries);
      }
      response.caps = { imported: Object.keys(capsEntries).length };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.log("Error importing from models.dev:", error);
    return NextResponse.json({ error: "Failed to import from models.dev" }, { status: 500 });
  }
}
