import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getSettings } from "@/lib/localDb";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    // Sync context window setting for max_tokens default
    try {
      const settings = await getSettings();
      if (settings.contextWindow) {
        process.env.CONTEXT_WINDOW = String(settings.contextWindow);
      }
    } catch {}
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {  
  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}

