import { NextResponse } from "next/server";
import { getProviderConnectionById, getApiKeys } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { pingModelByKind } from "@/app/api/models/test/ping";

const CLI_TOKEN_SALT = "9r-cli-auth";

// Same internal-credentials pattern as src/app/api/models/test/ping.js:
// self-fetches hit /api/* which is deny-by-default once requireLogin=true.
async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Compatible providers: fetch live model list. The self-fetch hits /api/*
    // which is deny-by-default under requireLogin=true, so it must carry the
    // same internal credentials as the ping route.
    if (isCompatible && models.length === 0) {
      let modelsRes;
      try {
        modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`, { headers: await getInternalHeaders() });
      } catch (error) {
        return NextResponse.json({ error: `Model list fetch failed: ${error?.message || "network error"}` }, { status: 502 });
      }
      if (!modelsRes.ok) {
        const detail = (await modelsRes.text().catch(() => "")).slice(0, 200);
        return NextResponse.json(
          { error: `Model list fetch failed: HTTP ${modelsRes.status}${detail ? ` — ${detail}` : ""}` },
          { status: 502 }
        );
      }
      try {
        const data = await modelsRes.json();
        models = (data.models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
      } catch { /* body without usable JSON → empty list */ }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    // This prevents race condition where multiple requests concurrently refresh the same token.
    const [first, ...rest] = models;
    const firstKind = first.kind || first.type || "llm";
    const firstResult = await pingModelByKind(`${alias}/${first.id}`, firstKind, baseUrl);
    const results = [{ modelId: first.id, name: first.name || first.id, ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model) => {
          const result = await pingModelByKind(`${alias}/${model.id}`, model.kind || model.type || "llm", baseUrl);
          return { modelId: model.id, name: model.name || model.id, ...result };
        })
      );
      results.push(...restResults);
    }

    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
