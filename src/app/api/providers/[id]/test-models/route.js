import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";

const MAX_MODELS_PER_BATCH = 100;
const MODEL_TIMEOUT_MS = 30000;
const MAX_CONSECUTIVE_RATE_LIMITS = 3;

function classifyResult(result) {
  const statusCode = Number(result?.status || result?.statusCode) || null;
  const isTimeout = result?.isTimeout === true;
  const rateLimited = result?.rateLimited === true || statusCode === 429;
  const isTransient = rateLimited || isTimeout || statusCode === 408 || statusCode === 425 || statusCode >= 500;
  const status = result?.ok === true
    ? "ok"
    : isTimeout
      ? "slow"
      : rateLimited
        ? "rate_limited"
        : "error";

  return {
    ...result,
    status,
    statusCode,
    rateLimited,
    isTransient,
    isTimeout,
  };
}

function errorResult(error, latencyMs) {
  const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
  return classifyResult({
    ok: false,
    latencyMs,
    error: isTimeout ? "Timed out waiting for a response" : (error?.message || "Model test failed"),
    status: isTimeout ? 504 : 500,
    isTimeout,
  });
}

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId. Tests the requested visible models sequentially through
 * the normal 9Router path while pinning each request to that connection.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const hasRequestedModelIds = Array.isArray(body.modelIds);
    const requestedModelIds = hasRequestedModelIds
      ? [...new Set(body.modelIds.filter((modelId) => typeof modelId === "string").map((modelId) => modelId.trim()).filter(Boolean))]
      : [];

    if (hasRequestedModelIds && requestedModelIds.length === 0) {
      return NextResponse.json({ error: "modelIds must contain at least one model" }, { status: 400 });
    }
    if (requestedModelIds.length > MAX_MODELS_PER_BATCH) {
      return NextResponse.json({ error: `A maximum of ${MAX_MODELS_PER_BATCH} models can be tested at once` }, { status: 400 });
    }

    const providerId = connection.provider;
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
    const configuredModels = getProviderModels(alias);
    let models = configuredModels;

    if (hasRequestedModelIds) {
      const configuredById = new Map(configuredModels.map((model) => [model.id, model]));
      models = requestedModelIds.map((idValue) => {
        const configured = configuredById.get(idValue);
        return configured || { id: idValue, name: idValue, kind: "llm" };
      });
    } else if (isCompatible && models.length === 0) {
      try {
        const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          models = (data.models || []).map((model) => ({
            id: model.id || model.name,
            name: model.name || model.id,
            kind: model.kind || model.type || "llm",
          })).filter((model) => model.id);
        }
      } catch {
        // The configured model list remains the fallback.
      }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    const results = [];
    let consecutiveRateLimits = 0;
    let stoppedEarly = false;

    for (const model of models.slice(0, MAX_MODELS_PER_BATCH)) {
      const startedAt = Date.now();
      let result;
      try {
        result = await pingModelByKind(
          `${alias}/${model.id}`,
          model.kind || model.type || "llm",
          baseUrl,
          { connectionId: id, timeoutMs: MODEL_TIMEOUT_MS }
        );
        result = classifyResult({ ...result, latencyMs: result.latencyMs ?? Date.now() - startedAt });
      } catch (error) {
        result = errorResult(error, Date.now() - startedAt);
      }

      results.push({
        modelId: model.id,
        name: model.name || model.id,
        ...result,
      });

      if (result.rateLimited) {
        consecutiveRateLimits += 1;
        if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
          stoppedEarly = true;
          break;
        }
      } else {
        consecutiveRateLimits = 0;
      }
    }

    const summary = {
      total: models.length,
      tested: results.length,
      working: results.filter((result) => result.status === "ok").length,
      failed: results.filter((result) => result.status === "error").length,
      slow: results.filter((result) => result.status === "slow").length,
      rateLimited: results.filter((result) => result.status === "rate_limited").length,
    };

    return NextResponse.json({
      provider: providerId,
      connectionId: id,
      results,
      summary,
      stoppedEarly,
      stopReason: stoppedEarly ? "consecutive_rate_limits" : null,
    });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
