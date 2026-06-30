import { createErrorResult, parseUpstreamError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Derive a provider's /images/edits endpoint from its image generations URL.
// Only OpenAI-style providers whose imageConfig.baseUrl ends in /generations
// are supported (DALL-E edits). Returns null otherwise.
export function deriveImageEditsUrl(imageConfig) {
  const rec = isRecord(imageConfig) ? imageConfig : undefined;
  const base = typeof rec?.baseUrl === "string" ? rec.baseUrl : undefined;
  if (base && /\/images\/generations$/.test(base)) return base.replace(/\/generations$/, "/edits");
  return null;
}

/**
 * Core image-edit handler — OpenAI-compatible /v1/images/edits multipart passthrough.
 * Forwards the client's multipart formData (image, mask, prompt, model, n, size,
 * response_format) verbatim to the provider's /images/edits endpoint, overriding
 * `model` with the resolved upstream id.
 *
 * @param {object} options
 * @param {FormData} options.formData
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} [options.credentials]
 * @param {object} [options.log]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleImageEditCore({
  formData,
  modelInfo,
  credentials = null,
  log = null,
  onRequestSuccess = null,
}) {
  const { provider, model } = modelInfo;
  const mediaCfg = PROVIDER_MEDIA[provider];
  const imageConfig = isRecord(mediaCfg) ? mediaCfg.imageConfig : undefined;
  const url = deriveImageEditsUrl(imageConfig);
  if (!url) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not expose an OpenAI-style /images/edits endpoint`);
  }

  // Rebuild formData with the resolved upstream model id (preserve File names).
  const upstream = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === "model") continue;
    if (value instanceof Blob) upstream.append(key, value, value.name || key);
    else upstream.append(key, value);
  }
  upstream.append("model", model);

  const headers = {};
  const cfg = isRecord(imageConfig) ? imageConfig : {};
  const cfgHeaders = isRecord(cfg.headers) ? cfg.headers : {};
  for (const [k, v] of Object.entries(cfgHeaders)) headers[k] = v;
  const key = credentials?.apiKey || credentials?.accessToken;
  if (key) headers.Authorization = `Bearer ${key}`;

  log?.debug?.("IMAGE-EDIT", `${provider} | ${model} | ${url}`);

  let res;
  try {
    res = await proxyAwareFetch(url, { method: "POST", headers, body: upstream });
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Image edit request failed");
  }

  if (!res.ok) {
    const errInfo = await parseUpstreamError(res, null);
    return createErrorResult(errInfo.statusCode || res.status, errInfo.message || `Upstream error from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const text = await res.text();
  return {
    success: true,
    status: res.status,
    response: new Response(text, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
