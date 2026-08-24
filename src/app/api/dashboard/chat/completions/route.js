import { handleChat } from "@/sse/handlers/chat";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const preferredConnectionId = request.headers.get("x-9r-internal-job") === "provider-model-test"
    ? request.headers.get("x-connection-id")
    : null;
  return handleChat(request, null, { skipApiKeyValidation: true, preferredConnectionId });
}
