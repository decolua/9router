import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@/lib/open-sse/translator/index";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initTranslators(); // changed from await since initTranslators returns void
    initialized = true;
    console.log("[SSE] Translators initialized for /v1/messages");
  }
}

/**
 * Handle CORS preflight
 */
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
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
export async function POST(request: Request): Promise<Response> {
  await ensureInitialized();
  return await handleChat(request);
}
