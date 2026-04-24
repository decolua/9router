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
    console.log("[SSE] Translators initialized");
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

export async function POST(request: Request): Promise<Response> {
  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}
