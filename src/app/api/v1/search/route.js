import { inferenceRoute } from "@/lib/observability/inferenceRoute.js";
import { handleSearch } from "@/sse/handlers/search.js";

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
 * POST /v1/search - Web search endpoint
 */
export const POST = inferenceRoute(handleSearch);
