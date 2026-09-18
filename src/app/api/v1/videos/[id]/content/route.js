import { handleVideoContent } from "@/sse/handlers/videoGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/videos/{request_id}/content - download finished video bytes */
export async function GET(request, { params }) {
  const { id } = await params;
  return await handleVideoContent(request, id);
}
