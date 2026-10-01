import { handleTts } from "@/sse/handlers/tts.js";
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

/** POST /v1/audio/speech - OpenAI-compatible TTS endpoint */
export async function POST(request) {
  return await withScopeAuth(handleTts)(request);
}
