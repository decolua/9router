import { handleChat } from "@/sse/handlers/chat.js";
import { correlateResponse, sanitizeErrorResponse } from "@/sse/utils/requestCorrelation.js";
import { initTranslators } from "open-sse/translator/index.js";

export { sanitizeErrorResponse };

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
  const serverRequestId = crypto.randomUUID();
  try {
    await ensureInitialized();
    return await handleChat(request, null, serverRequestId);
  } catch {
    return correlateResponse(new Response(JSON.stringify({ error: { message: "Responses request failed", type: "server_error", code: "internal_server_error" } }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    }), serverRequestId);
  }
}
