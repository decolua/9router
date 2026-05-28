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

export function withCors(response, request, extraHeaders = {}) {
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
