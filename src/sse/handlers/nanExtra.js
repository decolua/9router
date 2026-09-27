import { getSettings } from "@/lib/localDb";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getProviderCredentials, markAccountUnavailable, clearAccountError, extractApiKey, isValidApiKey } from "../services/auth.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_FIELDS = new Set(["prompt", "n", "size", "response_format", "seed", "guidance"]);

async function authenticated(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;
  const key = extractApiKey(request);
  return key && await isValidApiKey(key) ? null : errorResponse(401, "Invalid or missing API key");
}

async function sendToNan(model, url, body, headers) {
  const excluded = new Set();
  let lastStatus = 503;
  let lastError = "No NaN account available";
  while (true) {
    const credentials = await getProviderCredentials("nan", excluded, model);
    if (!credentials) return errorResponse(lastStatus, lastError);
    if (credentials.allRateLimited) {
      return unavailableResponse(lastStatus, lastError, credentials?.retryAfter, credentials?.retryAfterHuman);
    }
    if (!credentials.apiKey) return errorResponse(401, "NaN API key missing");
    let response;
    try {
      response = await proxyAwareFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.apiKey}`, ...headers },
        body,
        signal: AbortSignal.timeout(120000),
      }, await resolveConnectionProxyConfig(credentials.providerSpecificData || {}));
    } catch (error) {
      const failed = await markAccountUnavailable(credentials.connectionId, 502, error.message, "nan", model);
      if (failed.shouldFallback) {
        excluded.add(credentials.connectionId);
        lastStatus = 502;
        lastError = "NaN request failed";
        continue;
      }
      return errorResponse(502, "NaN request failed");
    }
    const bytes = await response.arrayBuffer();
    const responseHeaders = {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Access-Control-Allow-Origin": "*",
    };
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) responseHeaders["Retry-After"] = retryAfter;
    if (response.ok) {
      await clearAccountError(credentials.connectionId, credentials, model);
      return new Response(bytes, { status: response.status, headers: responseHeaders });
    }
    const message = new TextDecoder().decode(bytes).slice(0, 2000);
    const retrySeconds = Number(retryAfter);
    const resetAt = response.status === 429 && Number.isFinite(retrySeconds) && retrySeconds > 0
      ? Date.now() + retrySeconds * 1000 : null;
    const failed = await markAccountUnavailable(credentials.connectionId, response.status, message, "nan", model, resetAt);
    if (!failed.shouldFallback) return new Response(bytes, { status: response.status, headers: responseHeaders });
    excluded.add(credentials.connectionId);
    lastStatus = response.status;
    lastError = message.slice(0, 200);
  }
}

export async function rerank(request) {
  const denied = await authenticated(request);
  if (denied) return denied;
  let input;
  try { input = await request.json(); } catch { return errorResponse(400, "Invalid JSON body"); }
  const { model, query, documents, top_n } = input || {};
  if (model !== "nan/rerank" || typeof query !== "string" || !query.trim()
      || !Array.isArray(documents) || !documents.length || !documents.every((item) => typeof item === "string" && item.trim())) {
    return errorResponse(400, "Expected nan/rerank, non-empty query, and non-empty string documents");
  }
  if (top_n !== undefined && (!Number.isInteger(top_n) || top_n < 1 || top_n > documents.length)) {
    return errorResponse(400, "top_n must be between 1 and document count");
  }
  const body = JSON.stringify({ model: "rerank", query, documents, ...(top_n === undefined ? {} : { top_n }) });
  return sendToNan("rerank", PROVIDER_MEDIA.nan.rerankConfig.baseUrl, body, { "Content-Type": "application/json" });
}

export async function editImage(request) {
  const denied = await authenticated(request);
  if (denied) return denied;
  let input;
  try { input = await request.formData(); } catch { return errorResponse(400, "Invalid multipart body"); }
  if (input.get("model") !== "nan/flux-2-klein" || typeof input.get("prompt") !== "string" || !input.get("prompt").trim()
      || input.has("mask")) return errorResponse(400, "Expected nan/flux-2-klein, prompt, and no mask");
  const images = [...input.entries()].filter(([name]) => name === "image" || name === "image[]").map(([, value]) => value);
  if (!images.length || images.length > 4 || images.some((file) => !(file instanceof File) || !IMAGE_TYPES.has(file.type) || file.size > 25 * 1024 * 1024)) {
    return errorResponse(400, "Expected 1-4 PNG, JPEG, or WebP images up to 25 MiB each");
  }
  const body = new FormData();
  body.set("model", "flux-2-klein");
  for (const [name, value] of input) {
    if (IMAGE_FIELDS.has(name)) body.set(name, value);
  }
  for (const image of images) body.append("image[]", image, image.name);
  return sendToNan("flux-2-klein", PROVIDER_MEDIA.nan.imageConfig.editUrl, body, {});
}
