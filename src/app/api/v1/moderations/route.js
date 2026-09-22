import { handleModerations } from "@/sse/handlers/moderations.js";

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
 * POST /v1/moderations - Mistral Moderation endpoint
 */
export async function POST(request) {
  return await handleModerations(request);
}
