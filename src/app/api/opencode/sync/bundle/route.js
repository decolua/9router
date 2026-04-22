import { NextResponse } from "next/server";

import { getOpenCodePreferences, listOpenCodeTokens, touchOpenCodeTokenLastUsedAt } from "@/models";
import { buildOpenCodeSyncBundle } from "@/lib/opencodeSync/generator.js";
import { load9RouterModelCatalog } from "@/lib/opencodeSync/modelCatalog.js";
import { findMatchingSyncTokenRecord } from "@/lib/opencodeSync/tokens.js";

export const dynamic = "force-dynamic";

const VALIDATION_ERROR_CODES = new Set(["OPENCODE_VALIDATION_ERROR"]);

function isValidationError(error) {
  return VALIDATION_ERROR_CODES.has(error?.code) || error?.name === "OpenCodeValidationError";
}

async function generateAuthenticatedSyncBundle(request) {
  const tokenRecord = findMatchingSyncTokenRecord(await listOpenCodeTokens(), request.headers.get("authorization"));

  if (!tokenRecord) {
    return null;
  }

  const [preferences, modelCatalog] = await Promise.all([
    getOpenCodePreferences(),
    load9RouterModelCatalog(),
  ]);

  const bundle = buildOpenCodeSyncBundle({ preferences, modelCatalog });

  try {
    await touchOpenCodeTokenLastUsedAt(tokenRecord.id);
  } catch (error) {
    console.warn("Failed to update OpenCode sync token lastUsedAt:", error?.message || error);
  }

  return bundle;
}

function buildPublicSyncBundleResponse(bundle) {
  const publicArtifacts = bundle?.publicArtifacts ?? {};

  return {
    version: bundle.hash,
    opencode: publicArtifacts.opencode ?? null,
    ohMyOpencode: publicArtifacts.ohMyOpencode ?? null,
    ohMyOpenCodeSlim: publicArtifacts.ohMyOpenCodeSlim ?? null,
  };
}

export async function GET(request) {
  try {
    const bundle = await generateAuthenticatedSyncBundle(request);
    if (!bundle) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(buildPublicSyncBundleResponse(bundle));
  } catch (error) {
    if (isValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.log("Error generating OpenCode sync bundle:", error);
    return NextResponse.json({ error: "Failed to generate OpenCode sync bundle" }, { status: 500 });
  }
}
