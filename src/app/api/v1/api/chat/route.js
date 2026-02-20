import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import { enforceApiKeyQuota } from "@/shared/services/apiKeyQuota";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
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
  const requestForChat = request.clone();
  let bodyForQuota = null;
  try {
    const cloned = request.clone();
    bodyForQuota = await cloned.json();
  } catch {}

  const quota = await enforceApiKeyQuota(request, { model: bodyForQuota?.model || null });
  if (!quota.ok) {
    return quota.response;
  }

  await ensureInitialized();
  
  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body = await clonedReq.json();
    modelName = body.model || "llama3.2";
  } catch {}

  const response = await handleChat(requestForChat, null, { apiKeyId: quota.apiKeyId });
  return transformToOllama(response, modelName);
}

