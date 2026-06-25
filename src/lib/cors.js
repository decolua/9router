/**
 * CORS helper for LLM API routes.
 * Reflects origin only for loopback or configured tunnel origins.
 */

const ALLOWED_ORIGINS = new Set(["localhost", "127.0.0.1", "::1"]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (ALLOWED_ORIGINS.has(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowOrigin = isAllowedOrigin(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

export function corsOptionsResponse(request) {
  return new Response(null, { headers: getCorsHeaders(request) });
}

export function corsJsonResponse(body, init = {}, request) {
  return Response.json(body, {
    ...init,
    headers: { ...init.headers, ...getCorsHeaders(request) },
  });
}