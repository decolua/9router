import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";
const DEFAULT_TEST_TIMEOUT_MS = 15000;
const ANTIGRAVITY_TEST_TIMEOUT_MS = 45000;

function cleanBaseUrl(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function pushBaseUrl(urls, value) {
  const url = cleanBaseUrl(value);
  if (url && !urls.includes(url)) urls.push(url);
}

function getInternalBaseUrls() {
  const urls = [];
  pushBaseUrl(urls, process.env.MODEL_TEST_BASE_URL);
  pushBaseUrl(urls, process.env.INTERNAL_BASE_URL);
  if (process.env.PORT) pushBaseUrl(urls, `http://127.0.0.1:${process.env.PORT}`);
  pushBaseUrl(urls, process.env.BASE_URL);
  pushBaseUrl(urls, process.env.NEXT_PUBLIC_BASE_URL);
  pushBaseUrl(urls, `http://127.0.0.1:${UPDATER_CONFIG.appPort}`);
  pushBaseUrl(urls, "http://127.0.0.1:3000");
  return urls;
}

function getModelTestTimeoutMs(model) {
  const configured = Number(process.env.MODEL_TEST_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;

  const provider = String(model || "").split("/")[0]?.toLowerCase();
  if (provider === "ag" || provider === "antigravity") return ANTIGRAVITY_TEST_TIMEOUT_MS;
  return DEFAULT_TEST_TIMEOUT_MS;
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError"
    || error?.name === "AbortError"
    || /aborted due to timeout/i.test(error?.message || "");
}

function formatInternalFetchError(error, baseUrls) {
  const cause = error?.cause;
  const details = [
    error?.message || String(error),
    cause?.code,
    cause?.address && cause?.port ? `${cause.address}:${cause.port}` : null,
  ].filter(Boolean).join(" | ");
  return `Internal model test request failed: ${details}. Check MODEL_TEST_BASE_URL/PORT on the server. Tried: ${baseUrls.join(", ")}`;
}

async function fetchInternal(path, options) {
  const baseUrls = getInternalBaseUrls();
  let lastError = null;

  for (const baseUrl of baseUrls) {
    try {
      return await fetch(`${baseUrl}${path}`, options);
    } catch (error) {
      lastError = error;
      if (isTimeoutError(error)) throw error;
    }
  }

  throw new Error(formatInternalFetchError(lastError, baseUrls));
}

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  let timeoutMs = DEFAULT_TEST_TIMEOUT_MS;
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

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
    timeoutMs = getModelTestTimeoutMs(model);

    // Route to appropriate endpoint based on kind
    if (kind === "embedding") {
      const res = await fetchInternal("/api/v1/embeddings", {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: "test" }),
        signal: AbortSignal.timeout(timeoutMs),
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
    const res = await fetchInternal("/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 32,
        stream: false,
        messages: [{ role: "user", content: "Reply with OK only." }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
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
    if (isTimeoutError(err)) {
      return NextResponse.json(
        { ok: false, error: `Model test timed out after ${Math.round(timeoutMs / 1000)}s` },
        { status: 504 },
      );
    }
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  }
}
