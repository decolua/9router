import { randomUUID } from "node:crypto";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getExecutor } from "../executors/index.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_USER_AGENT = "codex-imagen/0.2.6";
const CODEX_VERSION = "0.122.0";
const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_MODEL_SUFFIX = "-image";
const CODEX_REF_DETAIL = "high";

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
  codex: {
    baseUrl: CODEX_RESPONSES_URL,
    format: "codex",
    stream: true,
  },
};

// Decode codex chatgpt account id from idToken if not stored
function decodeCodexAccountId(idToken) {
  try {
    const parts = String(idToken || "").split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (b64.length % 4)) % 4;
    const payload = JSON.parse(Buffer.from(b64 + "=".repeat(pad), "base64").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

// Strip "-image" suffix to get the underlying chat model
function stripCodexImageModel(model) {
  return model.endsWith(CODEX_MODEL_SUFFIX)
    ? model.slice(0, -CODEX_MODEL_SUFFIX.length)
    : model;
}

// Normalize a single ref image input to a data URL
function toCodexDataUrl(input) {
  if (!input) return null;
  if (typeof input !== "string") return null;
  if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input)) return input;
  // assume raw base64 PNG
  return `data:image/png;base64,${input}`;
}

// Build content array with optional reference images, mirroring codex-imagen tagging
function buildCodexContent(prompt, refs, detail = CODEX_REF_DETAIL) {
  const content = [];
  refs.forEach((url, index) => {
    content.push({ type: "input_text", text: `<image name=image${index + 1}>` });
    content.push({ type: "input_image", image_url: url, detail });
    content.push({ type: "input_text", text: "</image>" });
  });
  content.push({ type: "input_text", text: prompt });
  return content;
}

// Parse Codex SSE stream, log progress, return final base64 image.
// Optional callbacks let caller forward events to client (SSE pipe).
async function parseCodexImageStream(response, log, callbacks = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64 = null;
  let lastEvent = null;
  let bytesReceived = 0;
  let lastProgressLogMs = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesReceived += value?.byteLength || 0;
    buffer += decoder.decode(value, { stream: true });

    // SSE events separated by blank line
    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      const lines = block.split("\n");
      let eventName = null;
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (!eventName) continue;
      if (eventName !== lastEvent) {
        log?.info?.("IMAGE", `codex progress: ${eventName}`);
        lastEvent = eventName;
      }

      // Notify caller about progress (throttled to ~5/s to avoid flooding)
      const now = Date.now();
      if (callbacks.onProgress && now - lastProgressLogMs > 200) {
        lastProgressLogMs = now;
        callbacks.onProgress({ stage: eventName, bytesReceived });
      }

      if (eventName === "response.image_generation_call.partial_image" && dataStr) {
        try {
          const data = JSON.parse(dataStr);
          if (callbacks.onPartialImage && data?.partial_image_b64) {
            callbacks.onPartialImage({ b64_json: data.partial_image_b64, index: data.partial_image_index });
          }
        } catch {}
      }

      if (eventName === "response.output_item.done" && dataStr) {
        try {
          const data = JSON.parse(dataStr);
          const item = data?.item;
          if (item?.type === "image_generation_call" && item.result) {
            imageB64 = item.result;
          }
        } catch {}
      }
    }
  }
  return imageB64;
}

// Build SSE Response that pipes codex progress + partial + done events to client
function buildCodexSseResponse(providerResponse, log, onSuccess) {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event, data) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const b64 = await parseCodexImageStream(providerResponse, log, {
          onProgress: (info) => send("progress", info),
          onPartialImage: (info) => send("partial_image", info),
        });
        if (!b64) {
          send("error", { message: "Codex did not return an image. Account may not be entitled (Plus/Pro required)." });
        } else {
          if (onSuccess) await onSuccess();
          send("done", {
            created: Math.floor(Date.now() / 1000),
            data: [{ b64_json: b64 }],
          });
        }
      } catch (err) {
        send("error", { message: err?.message || "Stream failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

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
    case "codex":
      return CODEX_RESPONSES_URL;
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

  if (provider === "codex") {
    const accountId =
      credentials?.providerSpecificData?.chatgptAccountId ||
      decodeCodexAccountId(credentials?.idToken);
    return {
      "accept": "text/event-stream, application/json",
      "authorization": `Bearer ${credentials?.accessToken || ""}`,
      "chatgpt-account-id": accountId || "",
      "content-type": "application/json",
      "originator": CODEX_ORIGINATOR,
      "session_id": randomUUID(),
      "user-agent": CODEX_USER_AGENT,
      "version": CODEX_VERSION,
      "x-client-request-id": randomUUID(),
    };
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
  const { prompt, n = 1, size = "1024x1024", quality, style, response_format, image, images } = body;

  switch (provider) {
    case "codex": {
      const refs = [];
      if (Array.isArray(images)) images.forEach((i) => { const u = toCodexDataUrl(i); if (u) refs.push(u); });
      const single = toCodexDataUrl(image);
      if (single) refs.push(single);
      const detail = body.image_detail || CODEX_REF_DETAIL;
      const imgTool = { type: "image_generation", output_format: (body.output_format || "png").toLowerCase() };
      if (body.size && body.size !== "") imgTool.size = body.size;
      if (body.quality && body.quality !== "") imgTool.quality = body.quality;
      if (body.background && body.background !== "") imgTool.background = body.background;
      return {
        model: stripCodexImageModel(model),
        instructions: "",
        input: [{ type: "message", role: "user", content: buildCodexContent(prompt, refs, detail) }],
        tools: [imgTool],
        tool_choice: "auto",
        parallel_tool_calls: false,
        prompt_cache_key: randomUUID(),
        stream: true,
        store: false,
        reasoning: null,
      };
    }

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
  streamToClient = false,
  binaryOutput = false,
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
    if (provider === "huggingface") {
      const buffer = await providerResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      responseBody = {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: base64 }],
      };
    } else if (provider === "codex") {
      // SSE pipe to client (progress + partial_image + done)
      if (streamToClient) {
        return {
          success: true,
          response: buildCodexSseResponse(providerResponse, log, onRequestSuccess),
        };
      }
      const b64 = await parseCodexImageStream(providerResponse, log);
      if (!b64) {
        return createErrorResult(
          HTTP_STATUS.BAD_GATEWAY,
          "Codex did not return an image. Account may not be entitled (Plus/Pro required)."
        );
      }
      responseBody = {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64 }],
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

  // Binary output: decode first b64_json into raw bytes
  if (binaryOutput) {
    const first = normalized.data?.[0];
    const b64 = first?.b64_json;
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      const fmt = (body.output_format || "png").toLowerCase();
      const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
      return {
        success: true,
        response: new Response(buf, {
          headers: {
            "Content-Type": mime,
            "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`,
            "Access-Control-Allow-Origin": "*",
          },
        }),
      };
    }
  }

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
