import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
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
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
 */
export async function POST(request) {
  return await withScopeAuth(handleEmbeddings)(request);
}
