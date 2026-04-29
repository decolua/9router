import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { PROVIDER_ENDPOINTS } from "@/shared/constants/config";

// Probe a webSearch/webFetch provider using its searchConfig/fetchConfig.
// Returns true if API key is accepted (status !== 401 && !== 403).
async function probeWebProvider(provider, apiKey) {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  // Skip if provider has dual-purpose (LLM + search), let LLM validate handle it
  const kinds = p.serviceKinds || ["llm"];
  const isWebOnly = kinds.every((k) => k === "webSearch" || k === "webFetch");
  if (!isWebOnly) return null;
  const cfg = p.searchConfig || p.fetchConfig;
  if (!cfg) return null;
  if (cfg.authType === "none") return true; // no-auth (e.g. searxng)

  let url = cfg.baseUrl;
  const headers = { "Content-Type": "application/json" };
  let body;

  // Apply auth based on authHeader
  switch (cfg.authHeader) {
    case "bearer":              headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "x-api-key":           headers["x-api-key"] = apiKey; break;
    case "x-subscription-token":headers["x-subscription-token"] = apiKey; break;
    case "key":                 url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`; break; // google-pse
    case "api_key":             url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`; break; // searchapi
  }

  // Minimal body for POST endpoints; GET sends nothing
  if (cfg.method === "POST") {
    body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });
  }

  const res = await fetch(url, { method: cfg.method, headers, body, signal: AbortSignal.timeout(8000) });
  return res.status !== 401 && res.status !== 403;
}

// POST /api/providers/validate - Validate API key with provider
export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, apiKey, providerSpecificData } = body;

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
        const modelsUrl = `${node.baseUrl?.replace(/\/$/, "")}/models`;
        const res = await fetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
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

        let normalizedBase = node.baseUrl?.trim().replace(/\/$/, "") || "";
        if (normalizedBase.endsWith("/messages")) {
          normalizedBase = normalizedBase.slice(0, -9); // remove /messages
        }

        const modelsUrl = `${normalizedBase}/models`;

        const res = await fetch(modelsUrl, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Authorization": `Bearer ${apiKey}`
          },
        });

        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (provider === "cloudflare-ai") {
        const { providerSpecificData } = body;
        const accountId = providerSpecificData?.accountId;
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
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API token or Account ID",
        });
      }

      if (provider === "azure") {
        const { providerSpecificData } = body;
        const endpoint = (providerSpecificData?.azureEndpoint || "").replace(/\/$/, "");
        const deployment = providerSpecificData?.deployment || "gpt-4";
        const apiVersion = providerSpecificData?.apiVersion || "2024-10-01-preview";
        const organization = providerSpecificData?.organization;

        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        const headers = {
          "api-key": apiKey,
          "Content-Type": "application/json",
        };
        if (organization) headers["OpenAI-Organization"] = organization;

        const azureRes = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            messages: [{ role: "user", content: "test" }],
            max_tokens: 1,
          }),
        });
        isValid = azureRes.status !== 401 && azureRes.status !== 403;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key or Azure configuration",
        });
      }

      // Generic probe for webSearch/webFetch providers (config-driven)
      const webResult = await probeWebProvider(provider, apiKey);
      if (webResult !== null) {
        return NextResponse.json({
          valid: webResult,
          error: webResult ? null : "Invalid API key",
        });
      }

      switch (provider) {
        case "openai":
          const openaiRes = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openaiRes.ok;
          break;

        case "anthropic":
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

        case "gemini":
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
          isValid = geminiRes.ok;
          break;

        case "openrouter":
          const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` },
          });
          isValid = openrouterRes.ok;
          break;

        case "glm":
        case "glm-cn":
        case "kimi":
        case "minimax":
        case "minimax-cn":
        case "alicode-intl":
        case "alicode": {
          const claudeBaseUrls = {
            glm: "https://api.z.ai/api/anthropic/v1/messages",
            "glm-cn": "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
            kimi: "https://api.kimi.com/coding/v1/messages",
            minimax: "https://api.minimax.io/anthropic/v1/messages",
            "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
            alicode: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
            "alicode-intl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
          };

          // glm-cn, alicode and alicode-intl use OpenAI format
          if (provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl") {
            const testModel = getDefaultModel(provider);
            const glmCnRes = await fetch(claudeBaseUrls[provider], {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: testModel,
                max_tokens: 1,
                messages: [{ role: "user", content: "test" }],
              }),
            });
            isValid = glmCnRes.status !== 401 && glmCnRes.status !== 403;
          } else {
            const claudeRes = await fetch(claudeBaseUrls[provider], {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1,
                messages: [{ role: "user", content: "test" }],
              }),
            });
            isValid = claudeRes.status !== 401;
          }
          break;
        }
        case "volcengine-ark":
        case "byteplus": {
          const res = await fetch(PROVIDER_ENDPOINTS[provider], {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
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
        case "nvidia": {
          const endpoints = {
            deepseek: "https://api.deepseek.com/models",
            groq: "https://api.groq.com/openai/v1/models",
            xai: "https://api.x.ai/v1/models",
            mistral: "https://api.mistral.ai/v1/models",
            perplexity: "https://api.perplexity.ai/models",
            together: "https://api.together.xyz/v1/models",
            fireworks: "https://api.fireworks.ai/inference/v1/models",
            cerebras: "https://api.cerebras.ai/v1/models",
            cohere: "https://api.cohere.ai/v1/models",
            nebius: "https://api.studio.nebius.ai/v1/models",
            siliconflow: "https://api.siliconflow.cn/v1/models",
            hyperbolic: "https://api.hyperbolic.xyz/v1/models",
            ollama: "https://ollama.com/api/tags",
            "ollama-local": `${resolveOllamaLocalHost({ providerSpecificData })}/api/tags`,
            assemblyai: "https://api.assemblyai.com/v1/account",
            nanobanana: "https://api.nanobananaapi.ai/v1/models",
            chutes: "https://llm.chutes.ai/v1/models",
            nvidia: "https://integrate.api.nvidia.com/v1/models"
          };
          const headers = {};
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          const res = await fetch(endpoints[provider], { headers });
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
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: "test" }],
              max_tokens: 10,
            }),
          });
          // Returns 401 for invalid key, 200 for valid, 400 for malformed
          isValid = res.status === 200 || res.status === 400;
          break;
        }

        case "vertex": {
          // Raw key: probe global endpoint (always 404 for unknown model, never 401)
          // SA JSON: attempt token mint via JWT assertion
          const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
          if (saJson) {
            // Validate SA JSON has required fields
            isValid = !!(saJson.client_email && saJson.private_key && saJson.project_id);
          } else {
            // Raw key: probe Vertex — 404 means key is valid (model just doesn't exist), 401 means invalid key
            const probeRes = await fetch(
              `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
            );
            isValid = probeRes.status !== 401 && probeRes.status !== 403;
          }
          break;
        }

        case "vertex-partner": {
          const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
          if (saJson) {
            isValid = !!(saJson.client_email && saJson.private_key && saJson.project_id);
          } else {
            const probeRes = await fetch(
              `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
            );
            isValid = probeRes.status !== 401 && probeRes.status !== 403;
          }
          break;
        }

        case "grok-web": {
          const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
          // Cloudflare-bypass: send POST with same browser fingerprint headers as GrokWebExecutor
          const randomHex = (n) => {
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
          // Cookie valid = any non-401/403 response (200, 400, 429 all mean cookie accepted)
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

        default:
          return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
      }
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
