import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { parseImageEditsBody } from "open-sse/handlers/imageEdits.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/images/edits - OpenAI-compatible image edit endpoint (part of #5190) */
export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart body");
  }

  const parsed = await parseImageEditsBody(form);
  if (!parsed.ok) return errorResponse(parsed.status, parsed.error);

  // Reuse the full generations pipeline (auth, combos, routing, normalization)
  // by forwarding the parsed body as JSON with the original headers intact.
  const jsonRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(parsed.body),
  });
  return await handleImageGeneration(jsonRequest);
}
