import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnectionById } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const connection = await getProviderConnectionById(id) as ProviderConnection | null;
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const aliases = PROVIDER_ID_TO_ALIAS as Record<string, string>;
    const alias = aliases[providerId] || providerId;

    let models = getProviderModels(alias) as Array<{ id?: string; name?: string; kind?: string; type?: string }>;

    const baseUrl = `http://127.0.0.1:${process.env["PORT"] || UPDATER_CONFIG.appPort}`;

    // Compatible providers: fetch live model list
    if (isCompatible && models.length === 0) {
      try {
        const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`);
        if (modelsRes.ok) {
          const data = await modelsRes.json() as { models?: Array<{ id?: string; name?: string }> };
          models = (data.models || []).map((m) => {
            const entry: { id?: string; name?: string; kind?: string; type?: string } = {};
            const id = m.id || m.name;
            const name = m.name || m.id;
            if (id) entry.id = id;
            if (name) entry.name = name;
            return entry;
          });
        }
      } catch { /* fallback to empty */ }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    const [first, ...rest] = models;
    const firstKind = first!.kind || first!.type || "llm";
    const firstResult = await pingModelByKind(`${alias}/${first!.id}`, firstKind, baseUrl);
    const results = [{ modelId: first!.id, name: first!.name || first!.id, ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model) => {
          const result = await pingModelByKind(`${alias}/${model.id}`, model.kind || model.type || "llm", baseUrl);
          return { modelId: model.id, name: model.name || model.id, ...result };
        }),
      );
      results.push(...restResults);
    }

    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
