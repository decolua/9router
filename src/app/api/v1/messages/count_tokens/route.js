import { handleCountTokens } from "@/sse/handlers/countTokens.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/** Handle CORS preflight */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/** POST /v1/messages/count_tokens — native for Claude-compatible providers, else heuristic estimate. */
export async function POST(request) {
  return await handleCountTokens(request);
}
