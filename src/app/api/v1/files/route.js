import { Buffer } from "node:buffer";
import { createFile, listFiles } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export const maxDuration = 300;

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

async function checkAuth(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return true;
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return isValidApiKey(apiKey);
}

/** GET /v1/files — list uploaded files (optional ?purpose=). */
export async function GET(request) {
  if (!(await checkAuth(request))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const purpose = new URL(request.url).searchParams.get("purpose") || undefined;
  const data = await listFiles({ purpose });
  return Response.json({ object: "list", data });
}

/** POST /v1/files — multipart upload (file + purpose). */
export async function POST(request) {
  if (!(await checkAuth(request))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const file = formData.get("file");
  const purpose = formData.get("purpose");
  if (!file) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");
  if (typeof file === "string" || !(file instanceof Blob)) return errorResponse(HTTP_STATUS.BAD_REQUEST, "field 'file' must be a file upload");
  if (!purpose) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: purpose");
  const buffer = Buffer.from(await file.arrayBuffer());
  const meta = await createFile({
    buffer,
    filename: file.name || "upload",
    purpose,
    contentType: file.type || "application/octet-stream",
  });
  return Response.json(meta, { status: 201 });
}
