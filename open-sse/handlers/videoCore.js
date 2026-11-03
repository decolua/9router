import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshTokenByProvider } from "../services/tokenRefresh.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { getVideoAdapter } from "./videoProviders/index.js";

// Upstream fetch deadline for video job submission/polling (the job itself is
// async upstream — this only bounds the HTTP round-trip, not video rendering).
const VIDEO_FETCH_TIMEOUT_MS = Number(process.env.VIDEO_FETCH_TIMEOUT_MS || 120000);

// POST /videos/* creates a billable upstream job. A network error after the
// request left the socket may still have created the job, so creation is NEVER
// auto-retried (the only re-send is the auth retry after a 401/403 refresh,
// which upstream rejects before job creation).
export const VIDEO_ACTIONS = new Set(["generations", "edits", "extensions"]);

export function getVideoConfig(provider) {
  return PROVIDER_MEDIA[provider]?.videoConfig || null;
}

function isExecutorDrivenVideo(provider) {
  return PROVIDER_MEDIA[provider]?.videoConfig?.executorDriven === true;
}

/** Executor-driven generation: the browser executor returns base64 mp4. */
async function executeExecutorDrivenVideo({ provider, rawBody, credentials, signal, log, onCredentialsRefreshed }) {
  let parsed = {};
  try {
    parsed = JSON.parse(typeof rawBody === "string" ? rawBody : String(rawBody || "{}"));
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}] invalid video request body`);
  }
  if (!parsed.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}] video request requires a prompt`);
  }

  // Image-to-video: accept `image`/`image_url` (string) or `images`/`image_urls` (array)
  const imageRefs = []
    .concat(parsed.image ?? parsed.image_url ?? [])
    .concat(Array.isArray(parsed.images) ? parsed.images : [])
    .concat(Array.isArray(parsed.image_urls) ? parsed.image_urls : [])
    .filter((ref) => typeof ref === "string" && ref);

  const { getExecutor } = await import("../executors/index.js");
  const executor = getExecutor(provider);
  if (!executor?.generateMedia) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}] has no executor video support`);
  }

  try {
    const apiKeyBefore = credentials?.apiKey;
    const [media] = await executor.generateMedia({
      prompt: parsed.prompt,
      kind: "video",
      size: parsed.size,
      model: parsed.model,
      duration: parsed.seconds ?? parsed.duration,
      resolution: parsed.resolution,
      n: 1,
      images: imageRefs,
      credentials,
      signal,
      log,
    });
    const dataUrl = `data:${media.mime || "video/mp4"};base64,${media.b64}`;
    // Cookies that rotate on use (Clerk `__client`) are mutated in place by the
    // executor — persist the new value so the chain does not drift.
    if (onCredentialsRefreshed && credentials?.apiKey && credentials.apiKey !== apiKeyBefore) {
      await onCredentialsRefreshed({ apiKey: credentials.apiKey });
    }
    return {
      success: true,
      response: new Response(
        JSON.stringify({
          id: `video-${provider}-${Date.now()}`,
          object: "video.generation",
          created: Math.floor(Date.now() / 1000),
          model: parsed.model || provider,
          status: "completed",
          video: { url: dataUrl, ...(media.width ? { width: media.width } : {}), ...(media.height ? { height: media.height } : {}) },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      ),
    };
  } catch (error) {
    const message = sanitizeSecrets(error?.message || "video generation failed", credentials);
    const status = error?.status && Number.isInteger(error.status) ? error.status : 502;
    return createErrorResult(status, `[${provider}] ${message}`);
  }
}

/** Strip bearer tokens / obvious secrets from text destined for clients or logs. */
export function sanitizeSecrets(text, credentials = null) {
  if (!text) return text;
  let out = String(text).replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
  for (const key of ["accessToken", "refreshToken", "apiKey"]) {
    const secret = credentials?.[key];
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

function buildUpstreamUrl(config, action, requestId) {
  const base = config.baseUrl.replace(/\/$/, "");
  return requestId ? `${base}/${encodeURIComponent(requestId)}` : `${base}/${action}`;
}

function buildHeaders({ token, contentType, idempotencyKey }) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers["Content-Type"] = contentType;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

function combineSignals(signal, timeoutMs) {
  const timeoutSignal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timeoutSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal || timeoutSignal || undefined;
}

/**
 * Transparent proxy for async video jobs (xAI Grok Imagine shape).
 *
 * - Forwards the raw body byte-for-byte (JSON or multipart) — no reshaping.
 * - Passes upstream JSON (request_id, status, video.url, error) back verbatim.
 * - 401/403 with a refresh token: refresh ONCE, retry ONCE. No other retry.
 * - Upstream error text is sanitized before it reaches the client.
 *
 * @param {object} options
 * @param {string} options.provider - Provider id (must have registry videoConfig)
 * @param {"generations"|"edits"|"extensions"|null} options.action - Creation action (POST)
 * @param {string|null} [options.requestId] - Poll target (GET /videos/{id})
 * @param {Buffer|string|null} [options.rawBody] - Exact body to forward
 * @param {string|null} [options.contentType] - Original Content-Type header
 * @param {string|null} [options.idempotencyKey] - Forwarded Idempotency-Key
 * @param {object} options.credentials - { accessToken?, apiKey?, refreshToken?, authType? }
 * @param {AbortSignal} [options.signal] - Client cancellation signal
 * @param {number} [options.timeoutMs]
 * @param {object} [options.log]
 * @param {function} [options.onCredentialsRefreshed]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleVideoProxyCore({
  provider,
  action = null,
  requestId = null,
  rawBody = null,
  contentType = null,
  idempotencyKey = null,
  credentials,
  signal,
  timeoutMs = VIDEO_FETCH_TIMEOUT_MS,
  log,
  onCredentialsRefreshed,
}) {
  // Executor-driven providers (browser-automation web providers, e.g.
  // muse-web): the registry marks them with videoConfig.executorDriven and the
  // executor's generateMedia() produces the video synchronously as base64.
  // "generations" = text-to-video; "edits" = image-to-video (input images
  // are attached to the agent thread before the prompt).
  if (
    isExecutorDrivenVideo(provider) &&
    !requestId &&
    (action === "generations" || action === "edits")
  ) {
    return executeExecutorDrivenVideo({ provider, rawBody, credentials, signal, log, onCredentialsRefreshed });
  }

  const config = getVideoConfig(provider);
  if (!config) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support video generation`);
  }
  if (!requestId && !VIDEO_ACTIONS.has(action)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Unknown video action: ${action}`);
  }

  const adapter = getVideoAdapter(provider);
  const fetchSignal = combineSignals(signal, timeoutMs);

  // Default (xAI shape) request plan; adapters override URL/method/headers/body.
  const defaultPlan = () => {
    const method = requestId ? "GET" : "POST";
    return {
      method,
      url: buildUpstreamUrl(config, action, requestId),
      headers: buildHeaders({
        token: credentials?.accessToken || credentials?.apiKey,
        contentType: method === "POST" ? contentType : null,
        idempotencyKey: method === "POST" ? idempotencyKey : null,
      }),
      body: method === "POST" ? rawBody : undefined,
    };
  };

  // Rebuilt per attempt so the auth retry below picks up the refreshed token.
  const doFetch = async () => {
    const plan = adapter
      ? await adapter.buildRequest({
          config, action, requestId, rawBody, contentType, idempotencyKey, credentials, log,
          token: credentials?.accessToken || credentials?.apiKey,
        })
      : defaultPlan();
    if (plan.error) return { planError: plan.error };
    return {
      response: await fetch(plan.url, {
        method: plan.method,
        headers: plan.headers,
        body: plan.body,
        signal: fetchSignal,
      }),
    };
  };

  const method = requestId ? "GET" : "POST";
  let upstream;
  try {
    const first = await doFetch();
    if (first.planError) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}] ${first.planError}`);
    upstream = first.response;
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return createErrorResult(HTTP_STATUS.REQUEST_TIMEOUT, `[${provider}] video ${method} aborted: ${error.message}`);
    }
    // Never re-send a creation POST on network error — the job may already exist upstream.
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video upstream fetch failed: ${error.message}`, credentials));
  }

  // 401/403 → refresh once → retry once (OAuth accounts only; API keys can't refresh)
  if (
    (upstream.status === HTTP_STATUS.UNAUTHORIZED || upstream.status === HTTP_STATUS.FORBIDDEN) &&
    credentials?.refreshToken
  ) {
    let refreshed = null;
    try {
      refreshed = await refreshTokenByProvider(provider, credentials, log);
    } catch (error) {
      log?.warn?.("TOKEN", `${provider} | video refresh error: ${sanitizeSecrets(error.message, credentials)}`);
    }
    if (refreshed?.accessToken) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for video ${method}`);
      Object.assign(credentials, refreshed);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(refreshed);
      try {
        await upstream.body?.cancel?.();
      } catch { /* noop */ }
      try {
        const retry = await doFetch();
        if (retry.planError) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}] ${retry.planError}`);
        upstream = retry.response;
      } catch (error) {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video retry after refresh failed: ${error.message}`, credentials));
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | video refresh failed — account needs re-auth`);
    }
  }

  let bodyText;
  try {
    bodyText = await upstream.text();
  } catch (error) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video response read failed: ${error.message}`, credentials));
  }

  if (!upstream.ok) {
    const message = sanitizeSecrets(bodyText || `HTTP ${upstream.status}`, credentials);
    return createErrorResult(upstream.status, `[${provider}] ${message.slice(0, 2000)}`);
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `[${provider}] Invalid video response`);
  }
  let outBody = bodyText;
  let outType = upstream.headers.get("content-type") || "application/json";
  if (adapter?.transformResponse) {
    try {
      payload = adapter.transformResponse(payload);
      outBody = JSON.stringify(payload);
      outType = "application/json";
    } catch {
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `[${provider}] Invalid video response`);
    }
  }
  const valid = payload && typeof payload === "object" && !Array.isArray(payload)
    && !payload.error && payload.status !== "failed" && payload.status !== "error"
    && (requestId
      ? typeof payload.status === "string" && ["pending", "processing", "done", "completed"].includes(payload.status)
      : (typeof payload.request_id === "string" && payload.request_id.length > 0)
        || (typeof payload.id === "string" && payload.id.length > 0)
        || (provider === "vertex" && typeof payload.name === "string" && payload.name.length > 0));
  if (!valid) {
    const message = sanitizeSecrets(
      (typeof payload?.error === "string" ? payload.error : payload?.error?.message)
        || `[${provider}] Invalid or failed video response`, credentials
    );
    return {
      success: false,
      status: HTTP_STATUS.BAD_GATEWAY,
      error: message,
      response: new Response(JSON.stringify({ error: { message } }), { status: HTTP_STATUS.BAD_GATEWAY, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
    };
  }

  return {
    success: true,
    response: new Response(outBody, {
      status: upstream.status,
      headers: {
        "Content-Type": outType,
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
