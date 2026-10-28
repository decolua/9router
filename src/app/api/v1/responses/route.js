import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { contextOverflowAsResponsesFailure } from "open-sse/utils/responsesStreamHelpers.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
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
export async function POST(request) {
  await ensureInitialized();
  let stream = false;
  try { stream = (await request.clone().json())?.stream === true; } catch { /* handleChat reports the bad body */ }
  const response = await handleChat(request);
  return stream ? contextOverflowAsResponsesFailure(response) : response;
}
