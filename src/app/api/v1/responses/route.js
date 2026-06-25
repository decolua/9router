import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { corsOptionsResponse, getCorsHeaders } from "@/lib/cors.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS(request) {
  return corsOptionsResponse(request);
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request) {
  await ensureInitialized();
  const response = await handleChat(request);
  const corsHeaders = getCorsHeaders(request);
  if (response.headers && corsHeaders["Access-Control-Allow-Origin"]) {
    response.headers.set("Access-Control-Allow-Origin", corsHeaders["Access-Control-Allow-Origin"]);
  }
  return response;
}