import { startInference } from "@/lib/observability/requestContext.js";
import { readRequestKey } from "@/sse/services/requestKey.js";
import { handleVideoGet } from "@/sse/handlers/videoGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/videos/{request_id} - poll async video job status (xAI Grok Imagine) */
export async function GET(request, { params }) {
  const { id } = await params;
  return startInference(request, async () => {
    await readRequestKey(request);
    return handleVideoGet(request, id);
  });
}
