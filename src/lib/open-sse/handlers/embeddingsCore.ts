import { getModelTargetFormat, PROVIDER_ID_TO_ALIAS } from "../config/providerModels";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { getExecutor } from "../executors/index";
import { refreshWithRetry } from "../services/tokenRefresh";

const GEMINI_PROVIDERS = new Set(["gemini", "google_ai_studio"]);

function isGeminiProvider(provider: string): boolean {
  return GEMINI_PROVIDERS.has(provider);
}

function buildEmbeddingsBody(provider: string, model: string, input: any, encodingFormat?: string): any {
  if (isGeminiProvider(provider)) {
    const geminiModel = model.startsWith("models/") ? model : `models/${model}`;

    if (Array.isArray(input)) {
      return {
        requests: input.map((text) => ({
          model: geminiModel,
          content: { parts: [{ text: String(text) }] }
        }))
      };
    } else {
      return {
        model: geminiModel,
        content: { parts: [{ text: String(input) }] }
      };
    }
  }

  const body: any = { model, input };
  if (encodingFormat) {
    body.encoding_format = encodingFormat;
  }
  return body;
}

function buildEmbeddingsUrl(provider: string, model: string, credentials: any, input: any): string | null {
  if (isGeminiProvider(provider)) {
    const apiKey = credentials.apiKey || credentials.accessToken;
    const modelPath = model.startsWith("models/") ? model : `models/${model}`;

    if (Array.isArray(input)) {
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
      if (provider?.startsWith?.("openai-compatible-")) {
        const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
        return `${baseUrl.replace(/\/$/, "")}/embeddings`;
      }
      return null;
  }
}

function buildEmbeddingsHeaders(provider: string, credentials: any): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isGeminiProvider(provider)) {
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

function normalizeEmbeddingsResponse(responseBody: any, model: string, provider: string): any {
  if (responseBody.object === "list" && Array.isArray(responseBody.data)) {
    return responseBody;
  }

  if (isGeminiProvider(provider)) {
    let embeddingItems = [];

    if (Array.isArray(responseBody.embeddings)) {
      embeddingItems = responseBody.embeddings.map((emb: any, idx: number) => ({
        object: "embedding",
        index: idx,
        embedding: emb.values || []
      }));
    } else if (responseBody.embedding?.values) {
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

  return responseBody;
}

export interface EmbeddingsCoreOptions {
  body: any;
  modelInfo: { provider: string; model: string };
  credentials: any;
  log?: any;
  onCredentialsRefreshed?: (creds: any) => Promise<void>;
  onRequestSuccess?: () => Promise<void>;
}

/**
 * Core embeddings handler
 */
export async function handleEmbeddingsCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess
}: EmbeddingsCoreOptions): Promise<any> {
  const { provider, model } = modelInfo;

  const input = body.input;
  if (!input) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }
  if (typeof input !== "string" && !Array.isArray(input)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "input must be a string or array of strings");
  }

  const encodingFormat = body.encoding_format || "float";

  const url = buildEmbeddingsUrl(provider, model, credentials, input);
  if (!url) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support embeddings. Use openai, openrouter, gemini, or an openai-compatible provider.`
    );
  }

  const headers = buildEmbeddingsHeaders(provider, credentials);
  const requestBody = buildEmbeddingsBody(provider, model, input, encodingFormat);

  let providerResponse: Response;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });
  } catch (error: any) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  const executor = getExecutor(provider);
  if (
    !executor.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
    providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed && newCredentials) {
        await onCredentialsRefreshed(newCredentials);
      }

      try {
        const retryHeaders = buildEmbeddingsHeaders(provider, credentials);
        const retryUrl = isGeminiProvider(provider)
          ? buildEmbeddingsUrl(provider, model, credentials, input) || url
          : url;

        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody)
        });
      } catch (retryError) {
        // ignore
      }
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
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
