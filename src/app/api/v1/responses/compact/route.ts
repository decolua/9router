import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@/lib/open-sse/translator/index";

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initTranslators(); // changed from await since initTranslators returns void
    initialized = true;
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

/**
 * POST /v1/responses/compact - Compact conversation context
 * Reuses the same handleChat pipeline, signals compact via body._compact
 */
export async function POST(request: Request): Promise<Response> {
  await ensureInitialized();
  
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  body._compact = true;
  
  const newRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body)
  });
  
  return await handleChat(newRequest);
}
