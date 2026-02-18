import { getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/constants.js";
import { getExecutor } from "../executors/index.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";

// Google AI (Gemini) provider aliases / identifiers
const GEMINI_PROVIDERS = new Set(["gemini", "google_ai_studio"]);

/**
 * Check whether a provider targets the Google AI (Gemini) embeddings API.
 * @param {string} provider
 */
function isGeminiProvider(provider) {
  return GEMINI_PROVIDERS.has(provider);
}

/**
 * Build the embeddings request body for the target provider.
 *
 * - OpenAI / openai-compatible / openrouter: standard { model, input } format.
 * - Google AI (Gemini): different format per API spec.
 *   - Single input  → embedContent  body: { model, content: { parts: [{ text }] } }
 *   - Batch input   → batchEmbedContents body: { requests: [{ model, content: { parts: [{ text }] } }] }
 */
function buildEmbeddingsBody(provider, model, input, encodingFormat) {
  if (isGeminiProvider(provider)) {
    // Normalize model name: Gemini API expects "models/<model>" prefix
    const geminiModel = model.startsWith("models/") ? model : `models/${model}`;

    if (Array.isArray(input)) {
      // Batch request
      return {
        requests: input.map((text) => ({
          model: geminiModel,
          content: { parts: [{ text: String(text) }] }
        }))
      };
    } else {
      // Single request
      return {
        model: geminiModel,
        content: { parts: [{ text: String(input) }] }
      };
    }
  }

  // Default: OpenAI format
  const body = { model, input };
  if (encodingFormat) {
    body.encoding_format = encodingFormat;
  }
  return body;
}

/**
 * Build the URL for the embeddings endpoint based on the provider.
 * @param {string} provider
 * @param {string} model
 * @param {object} credentials
 * @param {string|string[]} input - The embeddings input (used to select single vs batch endpoint for Gemini)
 */
function buildEmbeddingsUrl(provider, model, credentials, input) {
  if (isGeminiProvider(provider)) {
    const apiKey = credentials.apiKey || credentials.accessToken;
    // Normalize model name for path
    const modelPath = model.startsWith("models/") ? model : `models/${model}`;

    if (Array.isArray(input)) {
      // Use batchEmbedContents for array input (even length=1 keeps response format consistent)
      return `https://generativelanguage.googleapis.com/v1beta/${modelPath}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    }
    return `https://generativelanguage.googleapis.com/v1beta/${modelPath}:embedContent?key=${encodeURIComponent(apiKey)}`;
  }

  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/embeddings";
    case "openrouter":
      return "https://openrouter.ai/api/v1/embeddings";
    default:
      // openai-compatible providers: use their baseUrl + /embeddings
      if (provider?.startsWith?.("openai-compatible-")) {
        const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
        return `${baseUrl.replace(/\/$/, "")}/embeddings`;
      }
      // For other providers, attempt to use their base URL pattern with /embeddings path
      return null;
  }
}

/**
 * Build headers for the embeddings request.
 */
function buildEmbeddingsHeaders(provider, credentials) {
  const headers = { "Content-Type": "application/json" };

  if (isGeminiProvider(provider)) {
    // Gemini API uses API key as query param — no Authorization header needed
    return headers;
  }

  switch (provider) {
    case "openai":
    case "openrouter":
      headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = "https://endpoint-proxy.local";
        headers["X-Title"] = "Endpoint Proxy";
      }
      break;
    default:
      headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
  }

  return headers;
}

/**
 * Normalize the embeddings response to OpenAI format.
 *
 * Gemini single response:
 *   { embedding: { values: [0.1, 0.2, ...] } }
 *
 * Gemini batch response:
 *   { embeddings: [{ values: [...] }, ...] }
 *
 * Target OpenAI format:
 *   { object: "list", data: [{ object: "embedding", index: 0, embedding: [...] }], model, usage: {...} }
 */
function normalizeEmbeddingsResponse(responseBody, model, provider) {
  // Already in OpenAI format
  if (responseBody.object === "list" && Array.isArray(responseBody.data)) {
    return responseBody;
  }

  if (isGeminiProvider(provider)) {
    let embeddingItems = [];

    if (Array.isArray(responseBody.embeddings)) {
      // Batch response
      embeddingItems = responseBody.embeddings.map((emb, idx) => ({
        object: "embedding",
        index: idx,
        embedding: emb.values || []
      }));
    } else if (responseBody.embedding?.values) {
      // Single response
      embeddingItems = [{
        object: "embedding",
        index: 0,
        embedding: responseBody.embedding.values
      }];
    }

    return {
      object: "list",
      data: embeddingItems,
      model,
      usage: {
        prompt_tokens: 0,
        total_tokens: 0
      }
    };
  }

  // Try to handle alternate formats gracefully
  return responseBody;
}

/**
 * Core embeddings handler — shared between Worker and SSE server.
 *
 * @param {object} options
 * @param {object} options.body - Parsed request body { model, input, encoding_format }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {function} [options.onCredentialsRefreshed] - Called when creds are refreshed
 * @param {function} [options.onRequestSuccess] - Called on success (clear error state)
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleEmbeddingsCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess
}) {
  const { provider, model } = modelInfo;

  // Validate input
  const input = body.input;
  if (!input) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }
  if (typeof input !== "string" && !Array.isArray(input)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "input must be a string or array of strings");
  }

  const encodingFormat = body.encoding_format || "float";

  // Determine embeddings URL
  const url = buildEmbeddingsUrl(provider, model, credentials, input);

  if (!url) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support embeddings. Use openai, openrouter, gemini, or an openai-compatible provider.`
    );
  }

  const headers = buildEmbeddingsHeaders(provider, credentials);
  const requestBody = buildEmbeddingsBody(provider, model, input, encodingFormat);

  log?.debug?.("EMBEDDINGS", `${provider.toUpperCase()} | ${model} | input_type=${Array.isArray(input) ? `array[${input.length}]` : "string"}`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("EMBEDDINGS", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh
  if (
    providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
    providerResponse.status === HTTP_STATUS.FORBIDDEN
  ) {
    const executor = getExecutor(provider);
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for embeddings`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed && newCredentials) {
        await onCredentialsRefreshed(newCredentials);
      }

      // Retry with refreshed credentials
      try {
        const retryHeaders = buildEmbeddingsHeaders(provider, credentials);
        // Rebuild URL with new API key for Gemini (key is in query param)
        const retryUrl = isGeminiProvider(provider)
          ? buildEmbeddingsUrl(provider, model, credentials, input)
          : url;

        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody)
        });
      } catch (retryError) {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse, provider);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("EMBEDDINGS", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch (parseError) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  if (onRequestSuccess) {
    await onRequestSuccess();
  }

  const normalized = normalizeEmbeddingsResponse(responseBody, model, provider);

  log?.debug?.("EMBEDDINGS", `Success | usage=${JSON.stringify(normalized.usage || {})}`);

  return {
    success: true,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    })
  };
}
