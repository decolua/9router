import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function fileToDataUri(file) {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/png";
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

/**
 * POST /v1/images/edits - OpenAI-compatible image edit endpoint (multipart).
 * Local reference images + optional mask are converted to data URIs and
 * forwarded through the standard generation flow (custom nodes supported).
 */
export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: { message: "Expected multipart/form-data body" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const model = form.get("model") || "cx/gpt-5.5-image";
  const prompt = form.get("prompt");
  if (!prompt) {
    return new Response(JSON.stringify({ error: { message: "Missing required field: prompt" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const size = form.get("size") || "1024x1024";
  const n = form.get("n") || "1";
  const responseFormat = form.get("response_format") || null;

  // Collect image files (local paths → data URIs)
  const images = [];
  const imageEntries = form.getAll("image");
  for (const entry of imageEntries) {
    if (entry instanceof File || entry?.arrayBuffer) {
      images.push(await fileToDataUri(entry));
    } else if (typeof entry === "string") {
      images.push(entry); // already a URL/data URI
    }
  }

  const mask = form.get("mask");
  if (mask instanceof File || mask?.arrayBuffer) {
    images.push(await fileToDataUri(mask));
  } else if (typeof mask === "string" && mask) {
    images.push(mask);
  }

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: { message: "At least one image or mask is required" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rebuild as JSON body and reuse the generation flow
  const jsonBody = { model, prompt, image: images, n: Number(n) || 1, size };
  if (responseFormat) jsonBody.response_format = responseFormat;

  const jsonRequest = new Request(request.url.replace(/\/edits$/, "/generations"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(request.headers.get("authorization") ? { authorization: request.headers.get("authorization") } : {}) },
    body: JSON.stringify(jsonBody),
  });

  return await handleImageGeneration(jsonRequest);
}
