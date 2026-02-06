import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { enforceApiKeyQuota } from "@/shared/services/apiKeyQuota";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

/**
 * Handle CORS preflight
 */
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

  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(requestForChat, null, { apiKeyId: quota.apiKeyId });
}

