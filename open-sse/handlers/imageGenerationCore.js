import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getExecutor } from "../executors/index.js";
import { getImageAdapter } from "./imageProviders/index.js";
import { decodeBase64Image, detectImageMime, readBoundedJsonResponse, urlToBase64 } from "./imageProviders/_base.js";

function serializeRequestBody(requestBody) {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

async function buildBinaryImageResponse(finalBody, proxyOptions) {
  const first = finalBody.data?.[0];
  let b64 = first?.b64_json;
  if (!b64 && first?.url) b64 = await urlToBase64(first.url, proxyOptions);
  const buffer = decodeBase64Image(b64);
  const mime = detectImageMime(buffer);
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  return new Response(buffer, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="image.${extension}"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Core image generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./imageProviders/{id}.js`.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, n, size, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {boolean} [options.streamToClient] - Pipe SSE to client (codex)
 * @param {boolean} [options.binaryOutput] - Return raw image bytes
 * @param {function} [options.onCredentialsRefreshed]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleImageGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  proxyOptions = null,
  streamToClient = false,
  binaryOutput = false,
  onCredentialsRefreshed,
  onRequestSuccess,
}) {
  const { provider, model } = modelInfo;

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  }

  const adapter = getImageAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support image generation`
    );
  }

  // Executor-delegating adapters: skip manual URL/headers/body, use the proven executor flow
  if (adapter.useExecutor && adapter.executeViaExecutor) {
    try {
      log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..." (executor)`);
      const responseBody = await adapter.executeViaExecutor(model, body, credentials, log, proxyOptions);
      if (onRequestSuccess) await onRequestSuccess();
      const normalized = adapter.normalize(responseBody, body.prompt);
      const finalBody = (normalized.created && Array.isArray(normalized.data)) ? normalized : responseBody;

      if (binaryOutput) {
        return { success: true, response: await buildBinaryImageResponse(finalBody, proxyOptions) };
      }

      return {
        success: true,
        response: new Response(JSON.stringify(finalBody), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    } catch (error) {
      const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
      log?.debug?.("IMAGE", `Executor error: ${errMsg}`);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
    }
  }

  let url;
  let headers;
  let requestBody;

  try {
    url = adapter.buildUrl(model, credentials);
    requestBody = await adapter.buildBody(model, body, proxyOptions);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message || `Invalid ${provider} image request`);
  }

  log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..."`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
      proxyOptions,
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh (skipped for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    !adapter.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log, proxyOptions),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for image generation`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryBody = await adapter.buildBody(model, body, proxyOptions);
        const retryHeaders = adapter.buildHeaders(credentials, retryBody, model, body);
        const retryUrl = adapter.buildUrl(model, credentials);
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: serializeRequestBody(retryBody),
          proxyOptions,
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("IMAGE", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  // Parse provider response — adapter may override (codex SSE / async polling / binary)
  let parsed;
  try {
    if (adapter.parseResponse) {
      parsed = await adapter.parseResponse(providerResponse, {
        headers,
        log,
        streamToClient,
        onRequestSuccess,
        url,
        requestBody,
        model,
        body,
        proxyOptions,
      });
      // Codex streaming case: returns an SSE Response directly
      if (parsed?.sseResponse) {
        return { success: true, response: parsed.sseResponse };
      }
    } else {
      parsed = await readBoundedJsonResponse(providerResponse);
    }
  } catch (parseError) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, parseError.message || `Invalid response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  // Normalize → OpenAI-compatible shape
  const normalized = adapter.normalize(parsed, body.prompt);

  // Already in OpenAI shape? skip re-normalize
  const finalBody = (normalized.created && Array.isArray(normalized.data)) ? normalized : parsed;

  // Binary output: decode first b64_json (or fetch url) into raw bytes
  if (binaryOutput) {
    try {
      return { success: true, response: await buildBinaryImageResponse(finalBody, proxyOptions) };
    } catch {
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Provider returned an invalid image");
    }
  }

  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
