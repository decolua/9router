import { NextResponse } from "next/server";
import { getProviderConnectionById, getApiKeys } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "@/lib/open-sse/config/providerModels";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

/**
 * Get an active API key to pass through auth when requireApiKey is enabled.
 */
async function getInternalApiKey(): Promise<string | null> {
  try {
    const keys = await getApiKeys();
    return keys.find((k: any) => k.isActive !== false)?.key || null;
  } catch {
    return null;
  }
}

/**
 * Ping a single model via internal completions endpoint (OpenAI format).
 * open-sse handles all provider translation automatically.
 */
async function pingModel(modelId: string, baseUrl: string, apiKey: string | null): Promise<any> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    // 200 = working; 400 = bad request but auth passed (model reachable)
    const ok = res.status === 200 || res.status === 400;
    let error = null;
    if (!ok) {
      const text = await res.text().catch(() => "");
      error = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`;
    }
    return { ok, latencyMs, error };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through /api/v1/chat/completions (open-sse handles everything).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const connection: any = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const alias = (PROVIDER_ID_TO_ALIAS as any)[providerId] || providerId;

    let models = getProviderModels(alias);

    // Compatible providers: fetch live model list
    if (isCompatible && models.length === 0) {
      try {
        const modelsRes = await fetch(`${getBaseUrl(request)}/api/providers/${id}/models`);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          models = (data.models || []).map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }));
        }
      } catch { /* fallback to empty */ }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    const baseUrl = getBaseUrl(request);
    const apiKey = await getInternalApiKey();

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    // This prevents race condition where multiple requests concurrently refresh the same token.
    const [first, ...rest] = models;
    const firstResult = await pingModel(`${alias}/${first.id}`, baseUrl, apiKey);
    const results = [{ modelId: first.id, name: first.name || first.id, ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model: any) => {
          const result = await pingModel(`${alias}/${model.id}`, baseUrl, apiKey);
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

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
