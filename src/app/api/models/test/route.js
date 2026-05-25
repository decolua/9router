import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind, speedTest } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Get an active internal API key for auth (if requireApiKey is enabled)
    let apiKey = null;
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    // Bypass dashboardGuard for internal self-call via CLI token (machineId-based)
    headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);

    const start = Date.now();

    // Route to appropriate endpoint based on kind
    if (kind === "embedding") {
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

    // Default: chat completions
    const maxTokens = speedTest ? 300 : 1;
    const testMessage = speedTest ? "Write a 200-word essay about the future of artificial intelligence." : "hi";

    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: "user", content: testMessage }],
      }),
      signal: AbortSignal.timeout(speedTest ? 60000 : 15000),
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

    const choiceContent = parsed?.choices?.[0]?.message?.content || "";
    let completionTokens = parsed?.usage?.completion_tokens || 0;

    // 1. Fallback to reasoning tokens if completion_tokens is 0 but reasoning tokens exist (e.g. Gemini 3 / Antigravity thinking)
    if (completionTokens === 0) {
      const reasoningTokens = parsed?.usage?.completion_tokens_details?.reasoning_tokens || 0;
      if (reasoningTokens > 0) {
        completionTokens = reasoningTokens;
      }
    }

    // 2. Fallback to character length estimation if we still have 0 tokens but have visible content
    if (completionTokens === 0 && choiceContent.length > 0) {
      // Estimate completion tokens: ~4 characters per token as a fallback for providers without usage metadata
      completionTokens = Math.max(1, Math.ceil(choiceContent.length / 4));
    }

    let tps = 0;
    if (speedTest && completionTokens > 0 && latencyMs > 0) {
      tps = Math.round((completionTokens / (latencyMs / 1000)) * 10) / 10;
    }

    return NextResponse.json({
      ok: true,
      latencyMs,
      tps,
      completionTokens,
      error: null,
      status: res.status
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
