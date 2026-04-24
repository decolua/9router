import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@/lib/open-sse/translator/index";

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initTranslators(); // changed from await since initTranslators returns void
    initialized = true;
    console.log("[SSE] Translators initialized for /v1/responses");
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request: Request): Promise<Response> {
  await ensureInitialized();
  return await handleChat(request);
}
