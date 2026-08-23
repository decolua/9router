import { handleChat } from "@/sse/handlers/chat";

export const dynamic = "force-dynamic";

export async function POST(request) {
  return handleChat(request, null, { skipApiKeyValidation: true });
}
