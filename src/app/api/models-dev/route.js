import { NextResponse } from "next/server";
import { getCatalog, getProviderModels } from "@/lib/modelsDev/index.js";
import { getProviderAlias } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

// GET /api/models-dev                → cache status + catalog provider list
// GET /api/models-dev?provider=xxx   → normalized models for a 9router provider (id or alias)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider) {
      const { catalog, fetchedAt, stale } = await getCatalog();
      const providers = Object.entries(catalog).map(([id, entry]) => ({
        id,
        name: entry?.name || id,
        modelCount: Object.keys(entry?.models || {}).length,
      }));
      return NextResponse.json({ fetchedAt, stale, providers });
    }

    const alias = getProviderAlias(provider) || provider;
    const result = await getProviderModels([alias, provider]);
    if (!result.modelsDevId) {
      return NextResponse.json(
        { error: `Provider ${provider} is not available on models.dev`, fetchedAt: result.fetchedAt, stale: result.stale },
        { status: 404 }
      );
    }

    return NextResponse.json({
      fetchedAt: result.fetchedAt,
      stale: result.stale,
      provider: alias,
      modelsDevId: result.modelsDevId,
      providerName: result.providerName,
      models: result.models,
    });
  } catch (error) {
    console.log("Error fetching models.dev catalog:", error);
    return NextResponse.json({ error: "Failed to fetch models.dev catalog" }, { status: 502 });
  }
}
