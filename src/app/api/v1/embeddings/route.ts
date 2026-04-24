import { handleEmbeddings } from "@/sse/handlers/embeddings";

/**
 * Handle CORS preflight
 */
export async function OPTIONS(): Promise<Response> {
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
export async function POST(request: Request): Promise<Response> {
  return await handleEmbeddings(request);
}
