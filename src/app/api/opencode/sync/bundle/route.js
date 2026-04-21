import { NextResponse } from "next/server";

import { getOpenCodePreferences, listOpenCodeTokens, touchOpenCodeTokenLastUsedAt } from "@/models";
import { buildOpenCodeSyncBundle } from "@/lib/opencodeSync/generator.js";
import { findMatchingSyncTokenRecord } from "@/lib/opencodeSync/tokens.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";

const VALIDATION_ERROR_CODES = new Set(["OPENCODE_VALIDATION_ERROR"]);

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

function filterOpenCodeModels(models) {
  if (Array.isArray(models)) {
    return models.filter((model) => getCatalogModelId(model).endsWith("-free"));
  }

  if (!models || typeof models !== "object") {
    return {};
  }

  return Object.keys(models).reduce((result, key) => {
    const model = models[key];
    const modelId = typeof key === "string" ? key.trim() : "";

    if (!modelId.endsWith("-free")) {
      return result;
    }

    if (model && typeof model === "object" && !Array.isArray(model)) {
      result[key] = model.id || model.key || model.model ? model : { ...model, id: modelId };
    } else {
      result[key] = model;
    }
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

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error("Failed to parse OpenCode model catalog response");
  }
  const rawModels = json?.data ?? json?.models ?? json;
  return filterOpenCodeModels(rawModels);
}

async function generateAuthenticatedSyncBundle(request) {
  const tokenRecord = findMatchingSyncTokenRecord(await listOpenCodeTokens(), request.headers.get("authorization"));

  if (!tokenRecord) {
    return null;
  }

  const [preferences, modelCatalog] = await Promise.all([
    getOpenCodePreferences(),
    loadOpenCodeModelCatalog(),
  ]);

  const bundle = buildOpenCodeSyncBundle({ preferences, modelCatalog });

  try {
    await touchOpenCodeTokenLastUsedAt(tokenRecord.id);
  } catch (error) {
    console.warn("Failed to update OpenCode sync token lastUsedAt:", error?.message || error);
  }

  return bundle;
}

export async function GET(request) {
  try {
    const bundle = await generateAuthenticatedSyncBundle(request);
    if (!bundle) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(bundle);
  } catch (error) {
    if (isValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.log("Error generating OpenCode sync bundle:", error);
    return NextResponse.json({ error: "Failed to generate OpenCode sync bundle" }, { status: 500 });
  }
}
