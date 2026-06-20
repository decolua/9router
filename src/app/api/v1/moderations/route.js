import { handleModerations } from "@/sse/handlers/moderations.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/moderations - OpenAI-compatible moderation passthrough. */
export async function POST(request) {
  return await handleModerations(request);
}
