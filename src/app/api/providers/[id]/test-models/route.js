import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { isGuardedCustomProvider } from "@/shared/utils/modelDiscoveryGuard.js";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through the internal endpoint that matches each model kind.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const guardedCustom = isGuardedCustomProvider(providerId);
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    if (guardedCustom) {
      const explicitIds = [
        ...(typeof body.model === "string"
          ? [body.model]
          : []),
        ...(Array.isArray(body.modelAllowlist)
          ? body.modelAllowlist
          : []),
      ]
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);

      const normalizeExplicitModelId = (value) => {
        let modelId = value;

        for (const prefix of [
          `${providerId}/`,
          `${alias}/`,
        ]) {
          if (modelId.startsWith(prefix)) {
            modelId = modelId.slice(prefix.length);
            break;
          }
        }

        return modelId.trim();
      };

      const uniqueIds = [
        ...new Set(
          explicitIds
            .map(normalizeExplicitModelId)
            .filter(Boolean),
        ),
      ];

      if (uniqueIds.length === 0) {
        return NextResponse.json(
          {
            error:
              "Custom/compatible provider bulk probing is disabled by default. "
              + "Specify body.model or body.modelAllowlist explicitly.",
            guard: {
              customProvider: true,
              autoProbe: false,
            },
          },
          { status: 403 },
        );
      }

      const explicitKind =
        isCustomEmbeddingProvider(providerId)
          ? "embedding"
          : "llm";

      models = uniqueIds.map((modelId) => ({
        id: modelId,
        name: modelId,
        kind: explicitKind,
      }));
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
