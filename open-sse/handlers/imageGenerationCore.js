import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getExecutor } from "../executors/index.js";

// Image provider configurations
const IMAGE_PROVIDERS = {
  openai: {
    baseUrl: "https://api.openai.com/v1/images/generations",
    format: "openai",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    format: "gemini",
  },
  minimax: {
    baseUrl: "https://api.minimaxi.com/v1/images/generations",
    format: "openai",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1/images/generations",
    format: "openai",
  },
  nanobanana: {
    baseUrl: "https://api.nanobananaapi.ai/api/v1/nanobanana/generate",
    format: "nanobanana",
  },
  sdwebui: {
    baseUrl: "http://localhost:7860/sdapi/v1/txt2img",
    format: "sdwebui",
  },
  comfyui: {
    baseUrl: "http://localhost:8188",
    format: "comfyui",
  },
  huggingface: {
    baseUrl: "https://api-inference.huggingface.co/models",
    format: "huggingface",
  },
};

/**
 * Build image generation URL
 */
function buildImageUrl(provider, model, credentials) {
  const config = IMAGE_PROVIDERS[provider];
  if (!config) return null;

  switch (provider) {
    case "gemini": {
      const apiKey = credentials?.apiKey || credentials?.accessToken;
      const modelId = model.replace(/^models\//, "");
      return `${config.baseUrl}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
    }
    case "huggingface":
      return `${config.baseUrl}/${model}`;
    default:
      return config.baseUrl;
  }
}

/**
 * Build request headers
 */
function buildImageHeaders(provider, credentials) {
  const headers = { "Content-Type": "application/json" };

  if (provider === "gemini") {
    return headers;
  }

  if (provider === "openrouter") {
    headers["Authorization"] = `Bearer ${credentials?.apiKey || credentials?.accessToken}`;
    headers["HTTP-Referer"] = "https://endpoint-proxy.local";
    headers["X-Title"] = "Endpoint Proxy";
    return headers;
  }

  if (provider === "huggingface") {
    headers["Authorization"] = `Bearer ${credentials?.apiKey || credentials?.accessToken}`;
    return headers;
  }

  if (credentials?.apiKey || credentials?.accessToken) {
    headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
  }

  return headers;
}

/**
 * Build request body based on provider format
 */
function buildImageBody(provider, model, body) {
  const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;

  switch (provider) {
    case "gemini":
      return {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      };

    case "sdwebui": {
      const [width, height] = size.split("x").map(Number);
      return {
        prompt,
        width: width || 512,
        height: height || 512,
        steps: 20,
        batch_size: n,
      };
    }

    case "nanobanana": {
      const sizeMap = {
        "1024x1024": "1:1",
        "1024x1792": "9:16",
        "1792x1024": "16:9",
      };
      return {
        prompt,
        type: "TEXTTOIAMGE",
        numImages: n,
        image_size: sizeMap[size] || "1:1",
      };
    }

    default:
      // OpenAI-compatible format
      const requestBody = { model, prompt, n, size };
      if (quality) requestBody.quality = quality;
      if (style) requestBody.style = style;
      if (response_format) requestBody.response_format = response_format;
      return requestBody;
  }
}

/**
 * Normalize response to OpenAI format
 */
function normalizeImageResponse(responseBody, provider, prompt) {
  // Already in OpenAI format
  if (responseBody.created && Array.isArray(responseBody.data)) {
    return responseBody;
  }

  const timestamp = Math.floor(Date.now() / 1000);

  switch (provider) {
    case "gemini": {
      const parts = responseBody.candidates?.[0]?.content?.parts || [];
      const images = parts
        .filter((p) => p.inlineData?.data)
        .map((p) => ({ b64_json: p.inlineData.data }));
      return {
        created: timestamp,
        data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
      };
    }

    case "sdwebui": {
      const images = Array.isArray(responseBody.images)
        ? responseBody.images.map((img) => ({ b64_json: img }))
        : [];
      return { created: timestamp, data: images };
    }

    case "nanobanana": {
      if (responseBody.image) {
        return {
          created: timestamp,
          data: [{ b64_json: responseBody.image, revised_prompt: prompt }],
        };
      }
      return { created: timestamp, data: [] };
    }

    case "huggingface": {
      // HuggingFace returns binary image data
      return responseBody;
    }

    default:
      return responseBody;
  }
}

/**
 * Core image generation handler
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, n, size, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {function} [options.onCredentialsRefreshed] - Called when creds are refreshed
 * @param {function} [options.onRequestSuccess] - Called on success
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleImageGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
}) {
  const { provider, model } = modelInfo;

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  }

  const url = buildImageUrl(provider, model, credentials);
  if (!url) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support image generation`
    );
  }

  const headers = buildImageHeaders(provider, credentials);
  const requestBody = buildImageBody(provider, model, body);

  log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..."`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for image generation`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed && newCredentials) {
        await onCredentialsRefreshed(newCredentials);
      }

      try {
        const retryHeaders = buildImageHeaders(provider, credentials);
        const retryUrl = provider === "gemini" ? buildImageUrl(provider, model, credentials) : url;

        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody),
        });
      } catch (retryError) {
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

  let responseBody;
  try {
    // HuggingFace returns binary image data
    if (provider === "huggingface") {
      const buffer = await providerResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      responseBody = {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: base64 }],
      };
    } else {
      responseBody = await providerResponse.json();
    }
  } catch (parseError) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid response from ${provider}`);
  }

  if (onRequestSuccess) {
    await onRequestSuccess();
  }

  const normalized = normalizeImageResponse(responseBody, provider, body.prompt);

  log?.debug?.("IMAGE", `Success | images=${normalized.data?.length || 0}`);

  return {
    success: true,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
