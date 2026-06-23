import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getProviderNodeById } from "@/models";
import { validateSearxngBaseUrl } from "open-sse/handlers/search/searxngUrlGuard.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveOllamaLocalHost, resolveXiaomiTokenplanBaseUrl, PROVIDERS as PROVIDERS_RAW } from "open-sse/config/providers.js";
import { openaiToCommandCodeRequest } from "open-sse/translator/request/openai-to-commandcode.js";
import { normalizeProviderId } from "@/lib/providerNormalization";

interface ProviderConfig {
  serviceKinds?: string[];
  searchConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string };
  fetchConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string };
  ttsConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string; extraHeaders?: Record<string, string> };
  sttConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string; extraHeaders?: Record<string, string> };
  embeddingConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string; extraHeaders?: Record<string, string> };
  imageConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string; extraHeaders?: Record<string, string> };
  videoConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string; extraHeaders?: Record<string, string> };
  musicConfig?: { authType?: string; authHeader?: string; method?: string; baseUrl?: string; extraHeaders?: Record<string, string> };
  noAuth?: boolean;
  format?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  authHeader?: string;
  validateUrl?: string;
}

const PROVIDERS = PROVIDERS_RAW as Record<string, ProviderConfig>;
// Probe a webSearch/webFetch provider using its searchConfig/fetchConfig.
// Returns true if API key is accepted (status !== 401 && !== 403).
async function probeWebProvider(provider: string, apiKey: string) {
  const p = AI_PROVIDERS[provider] as ProviderConfig | undefined;
  if (!p) return null;
  // Skip if provider has dual-purpose (LLM + search), let LLM validate handle it
  const kinds = p.serviceKinds ?? ["llm"];
  const isWebOnly = kinds.every((k) => k === "webSearch" || k === "webFetch");
  if (!isWebOnly) return null;
  const cfg = p.searchConfig ?? p.fetchConfig;
  if (!cfg) return null;
  if (cfg.authType === "none") return true; // no-auth (e.g. searxng)

  let url = cfg.baseUrl ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string | null = null;

  switch (cfg.authHeader) {
    case "bearer":               headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "x-api-key":            headers["x-api-key"] = apiKey; break;
    case "x-subscription-token": headers["x-subscription-token"] = apiKey; break;
    case "key":                  url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`; break;
    case "api_key":              url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`; break;
  }

  if (cfg.method === "POST") {
    body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });
  }

  const res = await fetch(url, { method: cfg.method ?? "GET", headers, body, signal: AbortSignal.timeout(8000) });
  return res.status !== 401 && res.status !== 403;
}

// Probe a media provider (tts/embedding/stt/image/video) using *Config.
// Returns true if API key is accepted; null to skip (let default handler decide).
async function probeMediaProvider(provider: string, apiKey: string) {
  const p = AI_PROVIDERS[provider] as ProviderConfig | undefined;
  if (!p) return null;
  const MEDIA_KINDS = new Set(["tts", "embedding", "stt", "image", "video", "music", "imageToText"]);
  const kinds = p.serviceKinds ?? ["llm"];
  const isMediaOnly = kinds.every((k) => MEDIA_KINDS.has(k));
  if (!isMediaOnly) return null;
  const cfg = p.ttsConfig ?? p.sttConfig ?? p.embeddingConfig ?? p.imageConfig ?? p.videoConfig ?? p.musicConfig;
  // No probe config → best-effort accept (validate at usage time)
  if (!cfg) return true;
  if (p.noAuth || cfg.authType === "none") return true;
  // Skip auth schemes that need provider-specific data
  if (cfg.authHeader === "playht" || cfg.authHeader === "aws-sigv4") return true;

  const headers: Record<string, string> = { "Content-Type": "application/json", ...(cfg.extraHeaders ?? {}) };

  switch (cfg.authHeader) {
    case "bearer":     headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "key":        headers["Authorization"] = `Key ${apiKey}`; break;
    case "x-api-key":  headers["x-api-key"] = apiKey; break;
    case "x-key":      headers["x-key"] = apiKey; break;
    case "xi-api-key": headers["xi-api-key"] = apiKey; break;
    case "token":      headers["Authorization"] = `Token ${apiKey}`; break;
    case "basic":      headers["Authorization"] = `Basic ${apiKey}`; break;
    default: return null;
  }

  const method = cfg.method ?? "POST";
  const res = await fetch(cfg.baseUrl ?? "", {
    method,
    headers,
    body: method === "GET" ? null : JSON.stringify({ input: "ping", text: "ping", prompt: "ping", model: getDefaultModel(provider) || "test" }),
    signal: AbortSignal.timeout(8000),
  });
  return res.status !== 401 && res.status !== 403;
}

interface ValidateBody {
  provider?: string;
  apiKey?: string;
  providerSpecificData?: Record<string, string | undefined>;
}

// POST /api/providers/validate - Validate API key with provider
export async function POST(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  try {
    const body = await request.json() as ValidateBody;
    const provider = normalizeProviderId(body.provider ?? "");
    const apiKey = body.apiKey ?? "";
    const providerSpecificData = body.providerSpecificData ?? {};

    const isNoAuth = (AI_PROVIDERS[provider] as ProviderConfig | undefined)?.noAuth === true;
    if (!provider || (!apiKey && provider !== "ollama-local" && !isNoAuth)) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    // SearXNG: validate the base URL if provided, then return valid immediately
    if (provider === "searxng") {
      const rawBaseUrl = providerSpecificData["baseUrl"] ?? "";
      if (rawBaseUrl) {
        const guard = validateSearxngBaseUrl(rawBaseUrl);
        if (!guard.ok) {
          return NextResponse.json({ valid: false, error: guard.error });
        }
      }
      return NextResponse.json({ valid: true, error: null });
    }

    let isValid = false;
    let error: string | null = null;

    try {
      if (isOpenAICompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
        }
        const baseUrl = typeof node["baseUrl"] === "string" ? node["baseUrl"] : "";
        const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
        const res = await fetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        isValid = res.ok;
        return NextResponse.json({ valid: isValid, error: isValid ? null : "Invalid API key" });
      }

      // Custom Embedding nodes: probe /models (most embedding APIs are OpenAI-compatible)
      if (isCustomEmbeddingProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
        }
        const baseUrl = typeof node["baseUrl"] === "string" ? node["baseUrl"] : "";
        const cleanBase = baseUrl.replace(/\/$/, "");
        const modelsRes = await fetch(`${cleanBase}/models`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        if (modelsRes.ok) {
          return NextResponse.json({ valid: true });
        }
        if (modelsRes.status === 401 || modelsRes.status === 403) {
          return NextResponse.json({ valid: false, error: "Invalid API key" });
        }
        // Fallback: probe /embeddings — many providers lack /models
        const embedRes = await fetch(`${cleanBase}/embeddings`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "test", input: "ping" }),
        });
        isValid = embedRes.status !== 401 && embedRes.status !== 403;
        return NextResponse.json({ valid: isValid, error: isValid ? null : "Invalid API key" });
      }

      if (isAnthropicCompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
        }
        const rawBase = typeof node["baseUrl"] === "string" ? node["baseUrl"] : "";
        let normalizedBase = rawBase.trim().replace(/\/$/, "");
        if (normalizedBase.endsWith("/messages")) {
          normalizedBase = normalizedBase.slice(0, -9);
        }
        const res = await fetch(`${normalizedBase}/models`, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Authorization": `Bearer ${apiKey}`,
          },
        });
        isValid = res.ok;
        return NextResponse.json({ valid: isValid, error: isValid ? null : "Invalid API key" });
      }

      if (provider === "cloudflare-ai") {
        const accountId = providerSpecificData["accountId"];
        if (!accountId) {
          return NextResponse.json({ valid: false, error: "Missing Account ID" });
        }
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
        const cfRes = await fetch(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: getDefaultModel("cloudflare-ai"),
            messages: [{ role: "user", content: "test" }],
            max_tokens: 1,
          }),
        });
        isValid = cfRes.status !== 401 && cfRes.status !== 403 && cfRes.status !== 404;
        return NextResponse.json({ valid: isValid, error: isValid ? null : "Invalid API token or Account ID" });
      }

      if (provider === "azure") {
        const endpoint = (providerSpecificData["azureEndpoint"] ?? "").replace(/\/$/, "");
        const deployment = providerSpecificData["deployment"] ?? "gpt-4";
        const apiVersion = providerSpecificData["apiVersion"] ?? "2024-10-01-preview";
        const organization = providerSpecificData["organization"];

        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        const azureHeaders: Record<string, string> = {
          "api-key": apiKey,
          "Content-Type": "application/json",
        };
        if (organization) azureHeaders["OpenAI-Organization"] = organization;

        const azureRes = await fetch(url, {
          method: "POST",
          headers: azureHeaders,
          body: JSON.stringify({ messages: [{ role: "user", content: "test" }], max_tokens: 1 }),
        });
        isValid = azureRes.status !== 401 && azureRes.status !== 403;
        return NextResponse.json({ valid: isValid, error: isValid ? null : "Invalid API key or Azure configuration" });
      }

      // Generic probe for webSearch/webFetch providers (config-driven)
      const webResult = await probeWebProvider(provider, apiKey);
      if (webResult !== null) {
        return NextResponse.json({ valid: webResult, error: webResult ? null : "Invalid API key" });
      }

      // Generic probe for tts/embedding providers (config-driven)
      const mediaResult = await probeMediaProvider(provider, apiKey);
      if (mediaResult !== null) {
        return NextResponse.json({ valid: mediaResult, error: mediaResult ? null : "Invalid API key" });
      }

      switch (provider) {
        case "openai": {
          const openaiRes = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openaiRes.ok;
          break;
        }

        case "vercel-ai-gateway": {
          const vercelAiGatewayRes = await fetch("https://ai-gateway.vercel.sh/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = vercelAiGatewayRes.ok;
          break;
        }

        case "anthropic": {
          const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = anthropicRes.status !== 401;
          break;
        }

        case "gemini": {
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
          isValid = geminiRes.ok;
          break;
        }

        case "openrouter": {
          const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openrouterRes.ok;
          break;
        }

        case "glm":
        case "glm-cn":
        case "kimi":
        case "minimax":
        case "minimax-cn":
        case "alicode-intl":
        case "alicode":
        case "agentrouter": {
          const cfg = PROVIDERS[provider] as ProviderConfig;
          const isOpenAiFormat = provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl";

          if (isOpenAiFormat) {
            const testModel = getDefaultModel(provider);
            const res = await fetch(cfg.baseUrl ?? "", {
              method: "POST",
              headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
              body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
            });
            isValid = res.status !== 401 && res.status !== 403;
          } else {
            const testModel = getDefaultModel(provider) || "claude-sonnet-4-20250514";
            const res = await fetch(cfg.baseUrl ?? "", {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                ...(cfg.headers ?? {}),
              },
              body: JSON.stringify({ model: testModel, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
            });
            // 400 = model resolution error but auth passed (e.g. agentrouter "no available channel")
            isValid = res.status !== 401 && res.status !== 403;
          }
          break;
        }

        case "volcengine-ark":
        case "byteplus": {
          const cfg = PROVIDERS[provider] as ProviderConfig;
          const res = await fetch(cfg.baseUrl ?? "", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model: getDefaultModel(provider),
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "deepseek":
        case "groq":
        case "xai":
        case "mistral":
        case "perplexity":
        case "together":
        case "fireworks":
        case "cerebras":
        case "cohere":
        case "nebius":
        case "siliconflow":
        case "hyperbolic":
        case "ollama":
        case "ollama-local":
        case "assemblyai":
        case "nanobanana":
        case "chutes":
        case "xiaomi-mimo":
        case "xiaomi-tokenplan":
        case "nvidia": {
          const endpoints: Record<string, string> = {
            ...Object.fromEntries(
              Object.entries(PROVIDERS as Record<string, ProviderConfig>)
                .filter(([, t]) => t.validateUrl)
                .map(([id, t]) => [id, t.validateUrl as string]),
            ),
            // dynamic URLs (depend on providerSpecificData) — kept inline
            "ollama-local": `${resolveOllamaLocalHost({ providerSpecificData })}/api/tags`,
            "xiaomi-tokenplan": `${resolveXiaomiTokenplanBaseUrl({ providerSpecificData })}/models`,
          };
          const authHeaders: Record<string, string> = {};
          if (apiKey) authHeaders["Authorization"] = `Bearer ${apiKey}`;
          const res = await fetch(endpoints[provider] ?? "", { headers: authHeaders });
          // xai returns 400 for bad key, 403 for valid-but-no-credit. Other providers use 401.
          if (provider === "xai") {
            isValid = res.status === 200 || res.status === 403;
          } else {
            isValid = res.ok;
          }
          break;
        }

        case "opencode-go": {
          const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: getDefaultModel("opencode-go"),
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false,
            }),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "commandcode": {
          const cfg = PROVIDERS["commandcode"] as ProviderConfig;
          const model = getDefaultModel("commandcode");
          const payload = openaiToCommandCodeRequest(model, {
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }, false);
          const res = await fetch(cfg.baseUrl ?? "", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(cfg.headers ?? {}),
              "x-session-id": crypto.randomUUID(),
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });
          isValid = res.status !== 401 && res.status !== 403;
          break;
        }

        case "deepgram": {
          const res = await fetch("https://api.deepgram.com/v1/projects", {
            headers: { "Authorization": `Token ${apiKey}` },
          });
          isValid = res.ok;
          break;
        }

        case "blackbox": {
          const res = await fetch("https://api.blackbox.ai/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: "test" }],
              max_tokens: 10,
            }),
          });
          isValid = res.status === 200 || res.status === 400;
          break;
        }

        case "vertex":
        case "vertex-partner": {
          // SA JSON: validate required fields; raw key: probe global endpoint
          let saJson: { client_email?: string; private_key?: string; project_id?: string; type?: string } | null = null;
          try {
            const parsed = JSON.parse(apiKey) as { type?: string; client_email?: string; private_key?: string; project_id?: string } | null;
            if (parsed !== null && parsed.type === "service_account") saJson = parsed;
          } catch { /* not JSON */ }

          if (saJson) {
            isValid = !!(saJson.client_email && saJson.private_key && saJson.project_id);
          } else {
            const probeRes = await fetch(
              `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
            );
            isValid = probeRes.status !== 401 && probeRes.status !== 403;
          }
          break;
        }

        case "grok-web": {
          const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
          const randomHex = (n: number) => {
            const a = new Uint8Array(n);
            crypto.getRandomValues(a);
            return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
          };
          const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
          const traceId = randomHex(16);
          const spanId = randomHex(8);
          const res = await fetch("https://grok.com/rest/app-chat/conversations/new", {
            method: "POST",
            headers: {
              Accept: "*/*",
              "Accept-Encoding": "gzip, deflate, br, zstd",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              "Content-Type": "application/json",
              Cookie: `sso=${token}`,
              Origin: "https://grok.com",
              Pragma: "no-cache",
              Referer: "https://grok.com/",
              "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"macOS"',
              "Sec-Fetch-Dest": "empty",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Site": "same-origin",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
              "x-statsig-id": statsigId,
              "x-xai-request-id": crypto.randomUUID(),
              traceparent: `00-${traceId}-${spanId}-00`,
            },
            body: JSON.stringify({
              temporary: true, modelName: "grok-4", modelMode: "MODEL_MODE_GROK_4", message: "ping",
              fileAttachments: [], imageAttachments: [],
              disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
              returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
              forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
              isReasoning: false, disableTextFollowUps: true, disableMemory: true,
              forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
            }),
          });
          if (res.status === 401 || res.status === 403) {
            isValid = false;
            error = "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso";
          } else {
            isValid = true;
          }
          break;
        }

        case "perplexity-web": {
          let sessionToken = apiKey;
          if (sessionToken.startsWith("__Secure-next-auth.session-token=")) {
            sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
          }
          const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
          const res = await fetch("https://www.perplexity.ai/rest/sse/perplexity_ask", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              Origin: "https://www.perplexity.ai",
              Referer: "https://www.perplexity.ai/",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
              "X-App-ApiClient": "default",
              "X-App-ApiVersion": "2.18",
              Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
            },
            body: JSON.stringify({
              query_str: "ping",
              params: {
                query_str: "ping", search_focus: "internet", mode: "concise", model_preference: "pplx_pro",
                sources: ["web"], attachments: [],
                frontend_uuid: crypto.randomUUID(), frontend_context_uuid: crypto.randomUUID(),
                version: "2.18", language: "en-US", timezone: tz,
                search_recency_filter: null, is_incognito: true, use_schematized_api: true, last_backend_uuid: null,
              },
            }),
          });
          if (res.status === 401 || res.status === 403) {
            isValid = false;
            error = "Invalid session cookie — re-paste __Secure-next-auth.session-token from perplexity.ai";
          } else {
            isValid = true;
          }
          break;
        }

        default: {
          // Generic probe for OpenAI-compatible providers (config-driven from PROVIDERS)
          const cfg = PROVIDERS[provider] as ProviderConfig | undefined;
          if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
            return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
          }
          if (cfg.noAuth) {
            isValid = true;
            break;
          }
          const defaultHeaders: Record<string, string> = { "Content-Type": "application/json", ...(cfg.headers ?? {}) };
          if (cfg.authHeader === "x-api-key") defaultHeaders["X-API-Key"] = apiKey;
          else defaultHeaders["Authorization"] = `Bearer ${apiKey}`;
          // Try /models first (fast GET), fallback to chat probe on ambiguous response
          const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
          let probeOk: boolean | null = null;
          try {
            const probeRes = await fetch(modelsUrl, { headers: defaultHeaders, signal: AbortSignal.timeout(8000) });
            if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
            else if (probeRes.ok) probeOk = true;
          } catch { /* fallback to chat */ }
          if (probeOk !== null) {
            isValid = probeOk;
            break;
          }
          // Fallback: minimal chat probe
          const defaultModel = getDefaultModel(provider) || "test";
          const chatRes = await fetch(cfg.baseUrl, {
            method: "POST",
            headers: defaultHeaders,
            body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
            signal: AbortSignal.timeout(10000),
          });
          isValid = chatRes.status !== 401 && chatRes.status !== 403;
          break;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      isValid = false;
    }

    return NextResponse.json({ valid: isValid, error: isValid ? null : (error ?? "Invalid API key") });
  } catch (error) {
    console.log("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
