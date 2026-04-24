import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@/lib/open-sse/translator/index";
import { transformToOllama } from "@/lib/open-sse/utils/ollamaTransform";

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initTranslators(); // changed from await since initTranslators returns void
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request: Request): Promise<Response> {
  await ensureInitialized();
  
  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body: any = await clonedReq.json();
    modelName = body.model || "llama3.2";
  } catch {}

  const response = await handleChat(request);
  return transformToOllama(response, modelName);
}
