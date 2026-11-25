import { inferenceRoute } from "@/lib/observability/inferenceRoute.js";
import { handleSystemone } from "@/sse/handlers/systemone.js";

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
 * POST /v1/systemone - System One (Jev) decision endpoint
 */
export const POST = inferenceRoute(handleSystemone);
