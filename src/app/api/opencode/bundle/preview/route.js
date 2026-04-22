import { NextResponse } from "next/server";

import { getOpenCodePreferences } from "@/models";
import { buildOpenCodeSyncPreview } from "@/lib/opencodeSync/generator.js";
import { load9RouterModelCatalog } from "@/lib/opencodeSync/modelCatalog.js";

const VALIDATION_ERROR_CODES = new Set(["OPENCODE_VALIDATION_ERROR"]);

export const dynamic = "force-dynamic";

function getCatalogModelId(model, fallbackId = "") {
  if (typeof model === "string") return model.trim();
  if (!model || typeof model !== "object" || Array.isArray(model)) return fallbackId;

  for (const key of ["id", "key", "model"]) {
    if (typeof model[key] === "string" && model[key].trim()) {
      return model[key].trim();
    }
  }

  return fallbackId;
}

function isValidationError(error) {
  return VALIDATION_ERROR_CODES.has(error?.code) || error?.name === "OpenCodeValidationError";
}

function buildCatalogModels(models) {
  if (Array.isArray(models)) {
    return models
      .map((model) => {
        const id = getCatalogModelId(model);
        if (!id) return null;

        return {
          id,
          name: typeof model?.name === "string" && model.name.trim() ? model.name.trim() : id,
          provider: typeof model?.provider === "string" && model.provider.trim() ? model.provider.trim() : id.split("/")[0] || "",
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  if (!models || typeof models !== "object") {
    return [];
  }

  return Object.keys(models)
    .map((key) => {
      const model = models[key];
      const id = getCatalogModelId(model, key);
      if (!id) return null;

      return {
        id,
        name: typeof model?.name === "string" && model.name.trim() ? model.name.trim() : id,
        provider: typeof model?.provider === "string" && model.provider.trim() ? model.provider.trim() : id.split("/")[0] || "",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildPublicPreviewResponse(preview, modelCatalog) {
  const publicArtifacts = preview?.publicArtifacts ?? {};

  return {
    version: preview?.hash ?? "",
    opencode: publicArtifacts.opencode ?? null,
    ohMyOpencode: publicArtifacts.ohMyOpencode ?? null,
    ohMyOpenCodeSlim: publicArtifacts.ohMyOpenCodeSlim ?? null,
    catalogModels: buildCatalogModels(modelCatalog),
  };
}

export async function GET() {
  try {
    const [preferences, modelCatalog] = await Promise.all([
      getOpenCodePreferences(),
      load9RouterModelCatalog(),
    ]);

    const preview = buildOpenCodeSyncPreview({ preferences, modelCatalog });

    return NextResponse.json(buildPublicPreviewResponse(preview, modelCatalog));
  } catch (error) {
    if (isValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.log("Error generating OpenCode bundle preview:", error);
    return NextResponse.json({ error: "Failed to generate OpenCode bundle preview" }, { status: 500 });
  }
}
