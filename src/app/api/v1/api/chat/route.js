import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama, ollamaErrorResponse } from "open-sse/utils/ollamaTransform.js";

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

export async function POST(request) {
  let modelName = "llama3.2";
  try {
    await ensureInitialized();

    const clonedReq = request.clone();
    try {
      const body = await clonedReq.json();
      modelName = body.model || "llama3.2";
    } catch {}

    const response = await handleChat(request);
    // transformToOllama propagates the real status/body of handleChat errors
    // (401→401 etc.) instead of masking them as an empty 200 NDJSON.
    return await transformToOllama(response, modelName);
  } catch (error) {
    // Any unexpected throw still reaches Ollama clients as a canonical error:
    // {"error":"..."} with a real status — never a silent empty success.
    const message = typeof error?.message === "string" && error.message ? error.message : "Internal server error";
    return ollamaErrorResponse(500, message);
  }
}

