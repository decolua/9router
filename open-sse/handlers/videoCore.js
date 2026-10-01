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

  const bodyText = await upstream.text().catch(() => "");

  if (!upstream.ok) {
    const message = sanitizeSecrets(bodyText || `HTTP ${upstream.status}`, credentials);
    return createErrorResult(upstream.status, `[${provider}] ${message.slice(0, 2000)}`);
  }

  // Success: pass the upstream JSON through untouched (request_id / status / video.url),
  // unless the adapter maps a provider-native shape onto it (Vertex operations).
  let outBody = bodyText;
  let outType = upstream.headers.get("content-type") || "application/json";
  if (adapter?.transformResponse) {
    try {
      outBody = JSON.stringify(adapter.transformResponse(JSON.parse(bodyText)));
      outType = "application/json";
    } catch {
      // Non-JSON or unexpected shape — fall back to the raw upstream body.
    }
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

/**
 * Proxy the finished video bytes: GET /v1/videos/{id}/content.
 *
 * Providers that return URLs (xAI, OpenRouter) guard them with the account
 * credential, so a client holding only a 9router key cannot fetch its own
 * result. This streams the bytes through using the stored upstream credential.
 *
 * Unlike handleVideoProxyCore this must NOT buffer: video payloads are large and
 * binary, so the upstream body is piped straight to the client.
 *
 * Providers whose poll already embeds the bytes (Vertex returns base64) have no
 * content endpoint and report unsupported.
 *
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleVideoContentCore({
  provider,
  requestId,
  index = 0,
  credentials,
  signal,
  timeoutMs = VIDEO_FETCH_TIMEOUT_MS,
  log,
}) {
  const config = getVideoConfig(provider);
  if (!config) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support video generation`);
  }
  if (!requestId) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing video request id");
  }

  const adapter = getVideoAdapter(provider);
  const token = credentials?.accessToken || credentials?.apiKey;

  // Default (xAI shape) mirrors the poll URL with /content appended.
  const plan = adapter?.buildContentRequest
    ? adapter.buildContentRequest({ config, requestId, index, token, credentials, log })
    : {
        method: "GET",
        url: `${config.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(requestId)}/content`,
        headers: buildHeaders({ token }),
      };

  if (plan.error) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `[${provider}] ${plan.error}`);
  if (plan.unsupported) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `[${provider}] ${plan.unsupported}`
    );
  }

  let upstream;
  try {
    upstream = await fetch(plan.url, {
      method: plan.method || "GET",
      headers: plan.headers,
      signal: combineSignals(signal, timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return createErrorResult(HTTP_STATUS.REQUEST_TIMEOUT, `[${provider}] video content aborted: ${error.message}`);
    }
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      sanitizeSecrets(`[${provider}] video content fetch failed: ${error.message}`, credentials)
    );
  }

  if (!upstream.ok) {
    const bodyText = await upstream.text().catch(() => "");
    const message = sanitizeSecrets(bodyText || `HTTP ${upstream.status}`, credentials);
    return createErrorResult(upstream.status, `[${provider}] ${message.slice(0, 2000)}`);
  }

  // Stream the bytes straight through — never buffered into memory.
  const headers = {
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
  };
  for (const header of ["content-length", "content-disposition", "etag", "last-modified", "accept-ranges"]) {
    const value = upstream.headers.get(header);
    if (value) headers[header] = value;
  }

  return { success: true, response: new Response(upstream.body, { status: upstream.status, headers }) };
}
