import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getProviderModels } from "open-sse/config/providerModels.js";

const CLI_TOKEN_SALT = "9r-cli-auth";

function getModelConfig(model) {
  const slash = model.indexOf("/");
  const providerAlias = slash >= 0 ? model.slice(0, slash) : "";
  const modelId = slash >= 0 ? model.slice(slash + 1) : model;
  return getProviderModels(providerAlias).find((item) => item.id === modelId);
}

function getImageTestBody(model, modelConfig = getModelConfig(model)) {
  return {
    model,
    prompt: "A simple test image",
    ...(modelConfig?.paramDefaults || {}),
  };
}

async function buildInternalHeaders(request, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const incomingAuthorization = request.headers.get("authorization");
  if (!headers["Authorization"] && incomingAuthorization) {
    headers["Authorization"] = incomingAuthorization;
  }

  const cookie = request.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const modelConfig = getModelConfig(model);
    const effectiveKind = kind || modelConfig?.type || "llm";

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Get an active internal API key for auth (if requireApiKey is enabled)
    let apiKey = null;
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const headers = await buildInternalHeaders(request, apiKey);

    const start = Date.now();

    // Route to appropriate endpoint based on kind
    if (effectiveKind === "embedding") {
      const res = await fetch(`${baseUrl}/api/v1/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: "test" }),
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - start;
      const rawText = await res.text().catch(() => "");
      let parsed = null;
      try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

      if (!res.ok) {
        const detail = parsed?.error?.message || parsed?.error || rawText;
        return NextResponse.json({ ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status });
      }
      const hasEmbedding = Array.isArray(parsed?.data) && parsed.data.length > 0 && Array.isArray(parsed.data[0]?.embedding);
      if (!hasEmbedding) {
        return NextResponse.json({ ok: false, latencyMs, status: res.status, error: "Provider returned no embedding data" });
      }
      return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
    }

    if (effectiveKind === "image") {
      const res = await fetch(`${baseUrl}/api/v1/images/generations`, {
        method: "POST",
        headers,
        body: JSON.stringify(getImageTestBody(model, modelConfig)),
        signal: AbortSignal.timeout(60000),
      });
      const latencyMs = Date.now() - start;
      const rawText = await res.text().catch(() => "");
      let parsed = null;
      try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

      if (!res.ok) {
        const detail = parsed?.error?.message || parsed?.error || rawText;
        return NextResponse.json({ ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status });
      }
      const hasImage = Array.isArray(parsed?.data) && parsed.data.length > 0 && (parsed.data[0]?.url || parsed.data[0]?.b64_json);
      if (!hasImage) {
        return NextResponse.json({ ok: false, latencyMs, status: res.status, error: "Provider returned no image data" });
      }
      return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
    }

    // Default: chat completions
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;

    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      const error = `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`;
      return NextResponse.json({ ok: false, latencyMs, error, status: res.status });
    }

    // Some providers may return HTTP 200 but not a real completion for invalid models.
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
        status: res.status,
        error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
      });
    }

    if (parsed?.error) {
      const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: String(providerError).slice(0, 240),
      });
    }

    const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
    if (!hasChoices) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: "Provider returned no completion choices for this model",
      });
    }

    return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
