import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { createDeferredResponsesResponse } from "open-sse/utils/responsesStreamBridge.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectClientTool } from "open-sse/utils/clientDetector.js";

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

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  if (body?.stream !== true) return handleChat(request, null, { body });

  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
  return createDeferredResponsesResponse(
    (signal) => handleChat(request, null, { body, signal }),
    {
      signal: request.signal,
      model: body?.model,
      eventKeepalive: detectClientTool(Object.fromEntries(request.headers), body) === "codex"
        || userAgent.includes("codex_cli_rs")
        || userAgent.includes("codex_exec"),
    },
  );
}
