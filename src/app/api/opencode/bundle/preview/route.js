import { NextResponse } from "next/server";

import { getOpenCodePreferences } from "@/models";
import { buildOpenCodeSyncPreview } from "@/lib/opencodeSync/generator.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";

function normalizeModelCatalog(models) {
  return models.reduce((result, model) => {
    if (!model?.id) return result;
    result[model.id] = {
      id: model.id,
      name: model.name || model.id,
    };
    return result;
  }, {});
}

function filterOpenCodeModels(models) {
  return models
    .filter((model) => model?.id?.endsWith("-free"))
    .map((model) => ({ id: model.id, name: model.id }));
}

async function loadOpenCodeModelCatalog() {
  const fetcher = FREE_PROVIDERS.opencode?.modelsFetcher;

  if (!fetcher?.url) {
    return {};
  }

  const response = await fetch(fetcher.url);
  if (!response.ok) {
    throw new Error(`Failed to load OpenCode model catalog: ${response.status}`);
  }

  const json = await response.json();
  const rawModels = json?.data ?? json?.models ?? json;
  const filteredModels = filterOpenCodeModels(Array.isArray(rawModels) ? rawModels : []);

  return normalizeModelCatalog(filteredModels);
}

export async function GET() {
  try {
    const [preferences, modelCatalog] = await Promise.all([
      getOpenCodePreferences(),
      loadOpenCodeModelCatalog(),
    ]);

    return NextResponse.json(buildOpenCodeSyncPreview({ preferences, modelCatalog }));
  } catch (error) {
    if (error?.message?.startsWith("Invalid") || error?.message?.includes("must be included") || error?.message?.includes("only valid")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.log("Error generating OpenCode bundle preview:", error);
    return NextResponse.json({ error: "Failed to generate OpenCode bundle preview" }, { status: 500 });
  }
}
