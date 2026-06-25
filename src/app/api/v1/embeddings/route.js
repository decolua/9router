import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import { corsOptionsResponse, getCorsHeaders } from "@/lib/cors.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request) {
  return corsOptionsResponse(request);
}

export async function POST(request) {
  const response = await handleEmbeddings(request);
  const corsHeaders = getCorsHeaders(request);
  if (response.headers && corsHeaders["Access-Control-Allow-Origin"]) {
    response.headers.set("Access-Control-Allow-Origin", corsHeaders["Access-Control-Allow-Origin"]);
  }
  return response;
}