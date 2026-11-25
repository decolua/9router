import { inferenceRoute } from "@/lib/observability/inferenceRoute.js";
import { handleVideoCreate } from "@/sse/handlers/videoGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/videos/extensions - async video extension (xAI Grok Imagine) */
export const POST = inferenceRoute(dispatchPost);

async function dispatchPost(request) {
  return await handleVideoCreate(request, "extensions");
}
