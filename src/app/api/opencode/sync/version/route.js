import { NextResponse } from "next/server";

import { getOpenCodePreferences, listOpenCodeTokens } from "@/models";
import { buildOpenCodeSyncBundle } from "@/lib/opencodeSync/generator.js";
import { findMatchingSyncTokenRecord } from "@/lib/opencodeSync/tokens.js";
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
  return filterOpenCodeModels(rawModels);
}

async function generateAuthenticatedSyncBundle(request) {
  const tokenRecord = findMatchingSyncTokenRecord(
    await listOpenCodeTokens(),
    request.headers.get("authorization")
  );

  if (!tokenRecord) {
    return null;
  }

  const [preferences, modelCatalog] = await Promise.all([
    getOpenCodePreferences(),
    loadOpenCodeModelCatalog(),
  ]);

  return buildOpenCodeSyncBundle({ preferences, modelCatalog });
}

export async function GET(request) {
  try {
    const bundle = await generateAuthenticatedSyncBundle(request);
    if (!bundle) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      revision: bundle.revision,
      hash: bundle.hash,
      generatedAt: bundle.generatedAt,
      schemaVersion: bundle.schemaVersion,
    });
  } catch (error) {
    if (isValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.log("Error generating OpenCode sync version:", error);
    return NextResponse.json({ error: "Failed to generate OpenCode sync version" }, { status: 500 });
  }
}
