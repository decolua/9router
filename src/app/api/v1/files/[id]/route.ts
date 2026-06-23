import type { NextRequest } from "next/server";
import { getFile, deleteFile } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

async function checkAuth(request: NextRequest) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return true;
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return isValidApiKey(apiKey);
}

/** GET /v1/files/:id — file metadata. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await checkAuth(request)))
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const { id } = await context.params;
  const meta = await getFile(id);
  if (!meta) return errorResponse(HTTP_STATUS.NOT_FOUND, "File not found");
  return Response.json(meta);
}

/** DELETE /v1/files/:id — delete a file. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await checkAuth(request)))
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const { id } = await context.params;
  const result = await deleteFile(id);
  if (!result) return errorResponse(HTTP_STATUS.NOT_FOUND, "File not found");
  return Response.json(result);
}
