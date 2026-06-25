import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { corsOptionsResponse, getCorsHeaders } from "@/lib/cors.js";

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
  return corsOptionsResponse(request);
}

export async function POST(request) {  
  // Fallback to local handling
  await ensureInitialized();
  
  const response = await handleChat(request);
  // Re-apply CORS to streamed response if needed
  const corsHeaders = getCorsHeaders(request);
  if (response.headers && corsHeaders["Access-Control-Allow-Origin"]) {
    response.headers.set("Access-Control-Allow-Origin", corsHeaders["Access-Control-Allow-Origin"]);
  }
  return response;
}