import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/video/generations - OpenAI-style video generation endpoint */
export async function POST(request) {
  const headers = new Headers(request.headers);
  headers.set("x-9r-auto-kind", "video");
  const routedRequest = new Request(request, { headers });
  return await handleImageGeneration(routedRequest);
}
