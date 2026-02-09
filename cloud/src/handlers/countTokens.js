import { errorResponse } from "open-sse/utils/error.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle POST /{machineId}/v1/messages/count_tokens
 * Mock token count response based on content length
 */
export async function handleCountTokens(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  // Estimate token count based on content length
  const messages = body.messages || [];
  let totalChars = 0;
  
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          totalChars += part.text.length;
        }
      }
    }
  }

  // Rough estimate: ~4 chars per token
  const inputTokens = Math.ceil(totalChars / 4);

  return new Response(JSON.stringify({
    input_tokens: inputTokens
  }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

