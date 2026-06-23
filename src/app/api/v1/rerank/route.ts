import type { NextRequest } from "next/server";
import { handleRerank } from "@/sse/handlers/rerank.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/rerank - Cohere/Jina/Voyage-style rerank passthrough. */
export async function POST(request: NextRequest) {
  return await handleRerank(request);
}
