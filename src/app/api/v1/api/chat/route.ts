import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";

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
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request: NextRequest) {
  await ensureInitialized();

  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body = (await clonedReq.json()) as Record<string, JsonValue>;
    modelName = typeof body["model"] === "string" ? body["model"] : "llama3.2";
  } catch {
    // keep default modelName
  }

  const response = await handleChat(request);
  return transformToOllama(response, modelName);
}
