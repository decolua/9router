/**
 * Multipart parser for POST /v1/images/edits (OpenAI-compatible image edit).
 *
 * Part of #5190: the img2img flow previously had no endpoint that accepted
 * reference images, so uploaded files were silently dropped. This module
 * converts the multipart form into the same JSON body shape consumed by
 * handleImageGeneration, with image/mask files embedded as data URIs
 * (matching the base64/data-URI forms buildBody already understands).
 */

function isFileLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.type === "string"
  );
}

async function fileToDataUri(file) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * Parse an images/edits multipart form into a generation body.
 * @returns {Promise<{ok:true,body:Object}|{ok:false,status:number,error:string}>}
 */
export async function parseImageEditsBody(form) {
  const prompt = form.get("prompt");
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { ok: false, status: 400, error: "Missing required field: prompt" };
  }

  const images = form.getAll("image").filter(isFileLike);
  if (images.length === 0) {
    return { ok: false, status: 400, error: "Missing required field: image (upload at least one image file)" };
  }

  const body = { prompt: prompt.trim(), image: await fileToDataUri(images[0]) };
  if (images.length > 1) {
    body.images = [];
    for (const extra of images.slice(1)) body.images.push(await fileToDataUri(extra));
  }

  const mask = form.get("mask");
  if (isFileLike(mask)) body.mask = await fileToDataUri(mask);

  for (const key of ["model", "size", "response_format", "background", "quality"]) {
    const value = form.get(key);
    if (typeof value === "string" && value !== "") body[key] = value;
  }
  const n = form.get("n");
  if (typeof n === "string" && n !== "" && Number.isFinite(Number(n))) body.n = Number(n);

  return { ok: true, body };
}
