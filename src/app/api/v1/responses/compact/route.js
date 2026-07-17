import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { parseJsonBody } from "@/shared/utils/parseJsonBody.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

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
 * POST /v1/responses/compact - Compact conversation context
 * Reuses the same handleChat pipeline, signals compact via body._compact
 */
export async function POST(request) {
  await ensureInitialized();
  let body;
  try {
    body = await parseJsonBody(request);
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  body._compact = true;
  // Strip content-encoding: body is already decoded plain JSON
  const headers = new Headers(request.headers);
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  const newRequest = new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return await handleChat(newRequest);
}
