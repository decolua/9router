import { handleFetch } from "@/sse/handlers/fetch.js";
import { withScopeAuth } from "@/middleware/scopeAuth.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/web/fetch - Web URL fetch/extract endpoint
 */
export async function POST(request) {
  return await withScopeAuth(handleFetch, { bodyMode: "json-provider", pseudoModelId: "fetch" })(request);
}
