import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { handleChat } from "@/sse/handlers/chat.js";
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
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/responses/compact - Compact conversation context */
export async function POST(request: NextRequest) {
  await ensureInitialized();
  const body = (await request.json()) as Record<string, JsonValue>;
  body["_compact"] = true;
  const newRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  return await handleChat(newRequest);
}
