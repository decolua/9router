import { DASHBOARD_AUTHORIZED_CONTEXT, handleChat } from "@/sse/handlers/chat.js";

export async function POST(request) {
  return handleChat(request, null, DASHBOARD_AUTHORIZED_CONTEXT);
}
