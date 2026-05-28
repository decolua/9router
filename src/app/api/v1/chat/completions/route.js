import { createCorsPreflightResponse, withCors } from "@/app/api/cors.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request) {
  return createCorsPreflightResponse(request);
}

export async function POST(request) {
  // Fallback to local handling
  await ensureInitialized();

  return withCors(await handleChat(request), request);
}
