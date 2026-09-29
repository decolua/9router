import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { resolveQoderCredentials, resolveQoderModels } from "open-sse/services/qoderModels.js";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { sanitizeOpenAICompatibleBaseUrl, openaiCompatFetchHeaders } from "open-sse/providers/shared.js";
import { probeConnection, probeAnthropicCompatBaseUrl } from "@/lib/providers/connectionProbe";

// POST /api/providers/validate - Validate API key with provider
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, providerSpecificData } = body;

    const isNoAuth = AI_PROVIDERS[provider]?.noAuth === true;
    if (!provider || (!apiKey && provider !== "ollama-local" && !isNoAuth)) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    let isValid = false;
    let error = null;

    // Validate with each provider
    try {
      if (isOpenAICompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
        }
        const modelsUrl = `${sanitizeOpenAICompatibleBaseUrl(node.baseUrl)}/models`;
        const res = await fetch(modelsUrl, {
          headers: openaiCompatFetchHeaders(apiKey),
        });
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      // Custom Embedding nodes: probe /models (most embedding APIs are OpenAI-compatible)
      if (isCustomEmbeddingProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
        }
        const baseUrl = node.baseUrl?.replace(/\/$/, "");
        const modelsRes = await fetch(`${baseUrl}/models`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        if (modelsRes.ok) {
          return NextResponse.json({ valid: true });
        }
        // Auth errors are definitive
        if (modelsRes.status === 401 || modelsRes.status === 403) {
          return NextResponse.json({ valid: false, error: "Invalid API key" });
        }
        // Fallback: probe /embeddings with a common test model — many providers lack /models
        const embedRes = await fetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "test", input: "ping" }),
        });
        // 401/403 = bad key; anything else (including 400 "model not found") means key works
        isValid = embedRes.status !== 401 && embedRes.status !== 403;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (isAnthropicCompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
        }
        const result = await probeAnthropicCompatBaseUrl(node.baseUrl || "", apiKey, node.defaultModel, fetch);
        return NextResponse.json(result);
      }

      // qoder needs job-token exchange (validate-route-specific: also confirms model list)
      if (provider === "qoder") {
        try {
          const resolved = await resolveQoderCredentials({ apiKey, providerSpecificData }, null, AbortSignal.timeout(8000));
          const result = await resolveQoderModels(resolved, { forceRefresh: true });
          isValid = !!result?.models?.length;
        } catch (err) {
          isValid = false;
          error = err.message;
        }
        return NextResponse.json({ valid: isValid, error: isValid ? null : (error || "Invalid API key") });
      }

      // Everything else — cloudflare-ai, azure, web/media config-driven providers,
      // fixed-endpoint providers, and the generic OpenAI-compat fallback — shares
      // one prober. See src/lib/providers/connectionProbe.js.
      const result = await probeConnection(provider, apiKey, { providerSpecificData });
      if (result.error === "Provider test not supported") {
        return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
      }
      return NextResponse.json(result);
    } catch (err) {
      error = err.message;
      isValid = false;
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : (error || "Invalid API key"),
    });
  } catch (error) {
    console.log("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
