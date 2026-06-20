import { getFileContent } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/files/:id/content — raw file bytes. */
export async function GET(request, { params }) {
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey || !(await isValidApiKey(apiKey))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  const file = await getFileContent(params.id);
  if (!file) return errorResponse(HTTP_STATUS.NOT_FOUND, "File not found");
  const safeName = (file.filename || "").replace(/["\r\n]/g, "_");
  return new Response(file.buffer, {
    status: 200,
    headers: {
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Disposition": safeName ? `attachment; filename="${safeName}"` : "attachment",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
