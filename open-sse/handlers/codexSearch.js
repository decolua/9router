import { randomUUID } from "node:crypto";

import { FETCH_CONNECT_TIMEOUT_MS, HTTP_STATUS } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createErrorResult } from "../utils/error.js";
import { resolveCodexAccountId } from "../utils/codexIdentity.js";

export const CODEX_SEARCH_URL = "https://chatgpt.com/backend-api/codex/alpha/search";

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry?.[1] ?? null;
}

export function normalizeCodexSearchBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("Search body must be a JSON object");
  }

  const normalized = { ...body };
  if (typeof normalized.model === "string") {
    normalized.model = normalized.model.replace(/^(?:cx|codex)\//, "");
  }
  return normalized;
}

export function buildCodexSearchHeaders(credentials, clientHeaders, requestId) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
    "Content-Type": "application/json",
    originator: getHeader(clientHeaders, "originator") || "codex_cli_rs",
    "session-id": getHeader(clientHeaders, "session-id") || requestId,
    "thread-id": getHeader(clientHeaders, "thread-id") || requestId,
    "x-client-request-id": getHeader(clientHeaders, "x-client-request-id") || requestId,
  };

  const userAgent = getHeader(clientHeaders, "user-agent");
  if (userAgent) headers["User-Agent"] = userAgent;

  const accountId = resolveCodexAccountId(credentials);
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;

  return headers;
}

export function codexSearchResponseHeaders(response) {
  const headers = new Headers(response.headers);
  // Undici decodes response bodies but can retain the original compression metadata.
  for (const name of ["connection", "content-encoding", "content-length", "transfer-encoding"]) {
    headers.delete(name);
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function upstreamErrorMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message || parsed?.message || parsed?.detail;
    if (message) return String(message);
  } catch {
    // Preserve a bounded plain-text upstream error when it is not JSON.
  }
  return String(text || `Codex search upstream returned HTTP ${status}`).replace(/\s+/g, " ").trim().slice(0, 1000);
}

export async function forwardCodexSearch({ body, credentials, clientHeaders, signal, log }) {
  if (!credentials?.accessToken) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Codex OAuth access token is missing");
  }
  if (!resolveCodexAccountId(credentials)) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Codex OAuth account ID is missing");
  }

  let normalizedBody;
  try {
    normalizedBody = normalizeCodexSearchBody(body);
  } catch (error) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message);
  }

  const requestId = typeof normalizedBody.id === "string" && normalizedBody.id
    ? normalizedBody.id
    : randomUUID();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_CONNECT_TIMEOUT_MS);
  const abortUpstream = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortUpstream, { once: true });

  try {
    const response = await proxyAwareFetch(CODEX_SEARCH_URL, {
      method: "POST",
      headers: buildCodexSearchHeaders(credentials, clientHeaders, requestId),
      body: JSON.stringify(normalizedBody),
      signal: controller.signal,
    }, credentials.providerSpecificData);

    if (response.ok) {
      return {
        success: true,
        response: new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: codexSearchResponseHeaders(response),
        }),
      };
    }

    const text = await response.text();
    return {
      success: false,
      status: response.status,
      error: upstreamErrorMessage(text, response.status),
      response: new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: codexSearchResponseHeaders(response),
      }),
    };
  } catch (error) {
    if (signal?.aborted && !timedOut) {
      return createErrorResult(499, "Client closed request");
    }
    const status = timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
    const code = error?.cause?.code || error?.code || error?.name;
    const message = error?.message || "Codex search request failed";
    const detail = code ? `${message} (${code})` : message;
    log?.warn?.("SEARCH", `Codex alpha/search fetch failed: ${detail}`);
    return createErrorResult(status, detail);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortUpstream);
  }
}
