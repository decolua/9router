import { handleVideoCreate } from "@/sse/handlers/videoGeneration.js";
import { withScopeAuth } from "@/middleware/scopeAuth.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/videos/edits - async video edit (xAI Grok Imagine) */
export async function POST(request) {
  return await withScopeAuth((req) => handleVideoCreate(req, "edits"))(request);
}
