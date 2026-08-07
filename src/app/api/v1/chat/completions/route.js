import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { rateLimit } from "@/lib/rate-limit.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
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
  // Rate limiting
  const rl = rateLimit(request);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...rl.headers,
      },
    });
  }

  // Fallback to local handling
  await ensureInitialized();

  try {
    const response = await handleChat(request);

    // Add rate limit headers to response
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(rl.headers)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    console.error("[Chat] POST handler error:", error);
    return new Response(JSON.stringify({
      error: { message: error?.message || "Internal server error", type: "server_error" }
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...rl.headers },
    });
  }
}

