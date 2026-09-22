import { handleOcr } from "@/sse/handlers/ocr.js";

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
 * POST /v1/ocr - Mistral OCR endpoint
 */
export async function POST(request) {
  return await handleOcr(request);
}
