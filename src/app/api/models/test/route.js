import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { requireAdmin } from "@/lib/auth/helpers";
import {
  getExecutor,
  refreshTokenByProvider,
  detectFormat,
  getTargetFormat,
  getModelTargetFormat,
  PROVIDER_ID_TO_ALIAS,
  translateRequest,
} from "open-sse/index.js";

// POST /api/models/test - Ping a model using the provider connection's credentials (no EGS Proxy AI API key)
export async function POST(request) {
  try {
    const body = await request.json();
    const { model, connectionId } = body || {};
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    if (!connectionId) {
      return NextResponse.json(
        { ok: false, error: "connectionId required (use the connection configured for this provider)." },
        { status: 400 }
      );
    }

    await requireAdmin(request);

    const connection = await getProviderConnectionById(connectionId, null);
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Connection not found" }, { status: 404 });
    }

    const credentials = {
      apiKey: connection.apiKey ?? connection.api_key,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      copilotToken: connection.copilotToken,
      projectId: connection.projectId,
      providerSpecificData: connection.providerSpecificData,
    };

    const modelId = model.includes("/") ? model.split("/").slice(1).join("/") : model;
    const minimalBody = {
      model: modelId,
      max_tokens: 1,
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    };
    const sourceFormat = detectFormat(minimalBody) || "openai";
    const alias = PROVIDER_ID_TO_ALIAS[connection.provider] || connection.provider;
    const targetFormat = getModelTargetFormat(alias, modelId) || getTargetFormat(connection.provider);
    const translatedBody = translateRequest(sourceFormat, targetFormat, modelId, minimalBody, false, credentials, connection.provider, null);
    if (translatedBody._toolNameMap) delete translatedBody._toolNameMap;
    translatedBody.model = modelId;

    const executor = getExecutor(connection.provider);
    const start = Date.now();

    let result;
    try {
      result = await executor.execute({
        model,
        body: translatedBody,
        stream: false,
        credentials,
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      return NextResponse.json({
        ok: false,
        latencyMs,
        error: err.message || String(err),
      });
    }

    let { response } = result;
    if (response.status === 401 || response.status === 403) {
      const newCreds = await refreshTokenByProvider(connection.provider, credentials);
      if (newCreds?.accessToken || newCreds?.copilotToken) {
        Object.assign(credentials, newCreds);
        try {
          result = await executor.execute({ model, body: translatedBody, stream: false, credentials });
          response = result.response;
        } catch (retryErr) {
          const latencyMs = Date.now() - start;
          return NextResponse.json({
            ok: false,
            latencyMs,
            error: retryErr.message || String(retryErr),
          });
        }
      }
    }

    const latencyMs = Date.now() - start;
    const rawText = await response.text().catch(() => "");
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {}

    if (!response.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      const error = `HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`;
      return NextResponse.json({ ok: false, latencyMs, error, status: response.status });
    }

    const providerStatus = parsed?.status;
    const providerMsg = parsed?.msg || parsed?.message;
    const hasProviderErrorStatus = providerStatus !== undefined
      && providerStatus !== null
      && String(providerStatus) !== "200"
      && String(providerStatus) !== "0";
    if (hasProviderErrorStatus && providerMsg) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: response.status,
        error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
      });
    }

    if (parsed?.error) {
      const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: response.status,
        error: String(providerError).slice(0, 240),
      });
    }

    // OpenAI format: choices[]; Anthropic/GLM format: content[]
    const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
    const hasContent = Array.isArray(parsed?.content) && parsed.content.length > 0;
    const hasValidCompletion = hasChoices || hasContent;
    if (!hasValidCompletion) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: response.status,
        error: "Provider returned no completion (expected choices or content)",
      });
    }

    return NextResponse.json({ ok: true, latencyMs, error: null, status: response.status });
  } catch (err) {
    const status = err.message === "Admin access required" || err.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ ok: false, error: err.message || "Test failed" }, { status });
  }
}
