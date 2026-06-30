import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { withEarlyStreamKeepalive } from "open-sse/utils/earlyStreamKeepalive.js";

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

  // Codex CLI and other Responses API consumers use SSE and may drop the
  // connection if no bytes arrive within a few seconds. Keep the connection warm
  // with early keepalives while the upstream produces its first token.
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  if (accept.includes("text/event-stream")) {
    return await withEarlyStreamKeepalive(handleChat(request), {
      signal: request.signal,
    });
  }

  return await handleChat(request);
}
