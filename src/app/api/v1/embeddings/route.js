import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import { rateLimit } from "@/lib/rate-limit.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
 */
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

  const response = await handleEmbeddings(request);

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
}
