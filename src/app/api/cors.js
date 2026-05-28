import { detectFormatByEndpoint, FORMATS } from "open-sse/translator/formats.js";

const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function parseAllowedOrigins() {
  return (process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveAllowedOrigin(request) {
  const origin = request?.headers?.get?.("origin") || "";
  const allowedOrigins = parseAllowedOrigins();

  if (allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) return origin;
    return "";
  }

  if (process.env.NODE_ENV === "production") {
    return origin && LOOPBACK_ORIGIN_RE.test(origin) ? origin : "";
  }

  return origin || "*";
}

export function buildCorsHeaders(request, extraHeaders = {}) {
  const allowedOrigin = resolveAllowedOrigin(request);
  const headers = {
    ...extraHeaders,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    if (allowedOrigin !== "*") headers.Vary = "Origin";
  }

  return headers;
}

export function createCorsPreflightResponse(request) {
  return new Response(null, { headers: buildCorsHeaders(request) });
}

export async function withCors(response, request, extraHeaders = {}) {
  const url = request?.url ? new URL(request.url) : null;
  const sourceFormat = url ? detectFormatByEndpoint(url.pathname, null) : null;

  if (response.status >= 400 && sourceFormat === FORMATS.CLAUDE) {
    try {
      const bodyText = await response.clone().text();
      const json = JSON.parse(bodyText);
      if (json && (json.error || json.message)) {
        const message = json.error?.message || json.message || "An error occurred";
        let anthropicErrorType = "invalid_request_error";
        if (response.status === 401) anthropicErrorType = "authentication_error";
        else if (response.status === 403) anthropicErrorType = "permission_error";
        else if (response.status === 429) anthropicErrorType = "rate_limit_error";
        else if (response.status >= 500) anthropicErrorType = "api_error";

        const formattedBody = JSON.stringify({
          type: "error",
          error: {
            type: anthropicErrorType,
            message: message,
          },
        });

        const headers = new Headers(response.headers);
        const corsHeaders = buildCorsHeaders(request, extraHeaders);
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value);
        }
        headers.set("Content-Type", "application/json");

        return new Response(formattedBody, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    } catch (e) {
      // Fall through to default response wrapping if parsing failed
    }
  }

  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request, extraHeaders);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
