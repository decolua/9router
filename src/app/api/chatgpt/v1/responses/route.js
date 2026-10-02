import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "open-sse/translator/index.js";
import { routeChatGPTResponse } from "@/lib/chatgpt/endpoint";

export const dynamic = "force-dynamic";
export async function POST(request) {
  await initTranslators();
  return routeChatGPTResponse(request, handleChat);
}
