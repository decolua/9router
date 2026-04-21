import { NextResponse } from "next/server";

import { getOpenCodePreferences } from "@/models";
import { buildOpenCodeSyncPreview } from "@/lib/opencodeSync/generator.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";

const VALIDATION_ERROR_PATTERNS = [
  /^Invalid\b/u,
  /must be included/u,
  /only valid/u,
  /^Default model\b/u,
];

function getCatalogModelId(model, fallbackId = "") {
  if (typeof model === "string") return model.trim();
  if (!model || typeof model !== "object" || Array.isArray(model)) return fallbackId;

  for (const key of ["id", "key", "model", "name"]) {
    if (typeof model[key] === "string" && model[key].trim()) {
      return model[key].trim();
    }
  }

  return fallbackId;
}

function isValidationError(error) {
  if (error instanceof SyntaxError) return true;

  const message = typeof error?.message === "string" ? error.message : "";
  return VALIDATION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function filterOpenCodeModels(models) {
  if (Array.isArray(models)) {
    return models.filter((model) => getCatalogModelId(model).endsWith("-free"));
  }

  if (!models || typeof models !== "object") {
    return {};
  }

  return Object.keys(models).reduce((result, key) => {
    const model = models[key];
    const modelId = getCatalogModelId(model, key);

    if (!modelId.endsWith("-free")) {
      return result;
    }

    result[key] = model;
    return result;
  }, {});
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
  const filteredModels = filterOpenCodeModels(rawModels);

  return filteredModels;
}

export async function GET() {
  try {
    const [preferences, modelCatalog] = await Promise.all([
      getOpenCodePreferences(),
      loadOpenCodeModelCatalog(),
    ]);

    return NextResponse.json(buildOpenCodeSyncPreview({ preferences, modelCatalog }));
  } catch (error) {
    if (isValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.log("Error generating OpenCode bundle preview:", error);
    return NextResponse.json({ error: "Failed to generate OpenCode bundle preview" }, { status: 500 });
  }
}
