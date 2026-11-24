import { handleChat } from "@/sse/handlers/chat.js";
import { parseJsonBody } from "@/shared/utils/parseJsonBody.js";
import { initTranslators } from "open-sse/translator/index.js";

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
    return Response.json({ error: { message: "Invalid JSON body", type: "invalid_request_error", code: "bad_request" } }, { status: 400 });
  }
  body._compact = true;
  const headers = new Headers(request.headers);
  // The rebuilt body is plain JSON, not the original compressed representation.
  headers.delete("content-encoding");
  headers.delete("content-length");
  const newRequest = new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return await handleChat(newRequest);
}
