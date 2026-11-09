import { extractApiKey, isValidApiKey } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { handleImageGeneration } from "./imageGeneration.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

const MAX_IMAGES = 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const MULTIPART_IMAGE_FIELDS = new Set(["image", "image[]", "images", "images[]"]);
const MULTIPART_NUMERIC_FIELDS = new Set(["n", "output_compression"]);

class ImageEditError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const badRequest = (message) => new ImageEditError(HTTP_STATUS.BAD_REQUEST, message);

// The client-supplied Content-Type is not trusted: only real raster image bytes are accepted.
function sniffImageMime(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function fileToDataUrl(file) {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageEditError(HTTP_PAYLOAD_TOO_LARGE, `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) throw badRequest("Unsupported image format: use PNG, JPEG, WEBP or GIF");
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function parseMultipart(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw badRequest("Invalid multipart body");
  }
  if (form.has("mask")) throw badRequest("mask is not supported");

  const fields = {};
  const files = [];
  for (const [key, value] of form.entries()) {
    if (MULTIPART_IMAGE_FIELDS.has(key)) {
      if (typeof value === "string") throw badRequest(`${key} must be a file upload`);
      files.push(value);
    } else if (typeof value === "string") {
      fields[key] = MULTIPART_NUMERIC_FIELDS.has(key) && value.trim() !== "" && !Number.isNaN(Number(value))
        ? Number(value)
        : value;
    }
  }
  if (files.length > MAX_IMAGES) throw badRequest(`At most ${MAX_IMAGES} images are allowed`);
  return { fields, images: await Promise.all(files.map(fileToDataUrl)) };
}

function jsonImageRef(ref) {
  if (typeof ref === "string") return ref;
  if (ref?.file_id) throw badRequest("file_id references are not supported");
  const url = ref?.image_url?.url ?? ref?.image_url;
  if (typeof url !== "string") throw badRequest("Each image must be a URL, data URL or { image_url }");
  return url;
}

async function parseJson(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
  const { image, images, mask, ...fields } = body || {};
  if (mask) throw badRequest("mask is not supported");
  const refs = [images, image].flat().filter(Boolean);
  if (refs.length > MAX_IMAGES) throw badRequest(`At most ${MAX_IMAGES} images are allowed`);
  return { fields, images: refs.map(jsonImageRef) };
}

/**
 * Handle POST /v1/images/edits by normalizing it into the /v1/images/generations contract,
 * so API key access, combos and account pools stay in one place.
 * @param {Request} request
 */
export async function handleImageEdit(request) {
  // Reject before buffering an upload: handleImageGeneration only authenticates after parsing.
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    if (!(await isValidApiKey(apiKey))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    return errorResponse(HTTP_PAYLOAD_TOO_LARGE, "Request body is too large");
  }

  let parsed;
  try {
    const isMultipart = (request.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
    parsed = await (isMultipart ? parseMultipart(request) : parseJson(request));
  } catch (error) {
    if (error instanceof ImageEditError) return errorResponse(error.status, error.message);
    throw error;
  }
  if (parsed.images.length === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: image");

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  const references = parsed.images.length === 1 ? { image: parsed.images[0] } : { images: parsed.images };
  return handleImageGeneration(new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...parsed.fields, ...references }),
  }));
}
