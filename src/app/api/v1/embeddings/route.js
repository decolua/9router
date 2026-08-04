import { handleEmbeddings } from "@/sse/handlers/embeddings.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reqHeaders = request?.headers?.get("Access-Control-Request-Headers");
  if (reqHeaders) headers["Access-Control-Allow-Headers"] = reqHeaders;
  return new Response(null, { headers });
}

/**
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
 */
export async function POST(request) {
  return await handleEmbeddings(request);
}
