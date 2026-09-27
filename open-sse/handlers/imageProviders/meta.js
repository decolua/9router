// Meta AI — Muse Image (api.meta.ai), OpenAI-compatible image generation + edits.
// Same base URL and MODEL_API_KEY as Muse Spark; output is base64 or a signed URL.
import { nowSec, urlToBase64 } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const CFG = PROVIDER_MEDIA["meta"]?.imageConfig || {};
const GENERATIONS_URL = CFG.baseUrl;
const EDITS_URL = CFG.editsUrl;

function collectImageInputs(body) {
  const inputs = [];
  if (Array.isArray(body?.images)) inputs.push(...body.images.filter(Boolean));
  if (body?.image) inputs.push(body.image);
  return inputs;
}

function isEdit(body) {
  return collectImageInputs(body).length > 0;
}

// data URL | raw base64 | remote URL | byte array → { blob, filename }
async function toImagePart(value, index) {
  let bytes;
  let mime = "image/png";
  if (Array.isArray(value)) {
    bytes = Buffer.from(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    const dataUrl = /^data:(image\/[^;]+);base64,(.+)$/i.exec(trimmed);
    if (dataUrl) {
      mime = dataUrl[1];
      bytes = Buffer.from(dataUrl[2], "base64");
    } else if (/^https?:\/\//i.test(trimmed)) {
      bytes = Buffer.from(await urlToBase64(trimmed), "base64");
    } else {
      bytes = Buffer.from(trimmed, "base64");
    }
  } else {
    throw new Error("meta: unsupported image input");
  }
  const ext = mime.split("/")[1] || "png";
  return { blob: new Blob([bytes], { type: mime }), filename: `image-${index}.${ext}` };
}

export default {
  // Generations and edits share auth/model/prompt; pick the endpoint from the body.
  buildUrl: (_model, _creds, body) => (isEdit(body) ? EDITS_URL : GENERATIONS_URL),

  buildHeaders: (creds, requestBody) => {
    const headers = {};
    // FormData sets its own multipart boundary — never override Content-Type.
    if (!(typeof FormData !== "undefined" && requestBody instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },

  buildBody: async (model, body) => {
    if (!isEdit(body)) {
      const req = { model, prompt: body.prompt, n: body.n ?? 1 };
      if (body.size) req.size = body.size;
      if (body.response_format) req.response_format = body.response_format;
      return req;
    }

    // /v1/images/edits expects multipart/form-data.
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", body.prompt);
    form.append("n", String(body.n ?? 1));
    if (body.size) form.append("size", body.size);
    if (body.response_format) form.append("response_format", body.response_format);

    const inputs = collectImageInputs(body);
    for (let i = 0; i < inputs.length; i += 1) {
      const { blob, filename } = await toImagePart(inputs[i], i);
      form.append("image", blob, filename);
    }

    const mask = body.mask ?? body.mask_image ?? body.maskImage;
    if (mask) {
      const { blob, filename } = await toImagePart(mask, 0);
      form.append("mask", blob, filename);
    }
    return form;
  },

  // Meta returns OpenAI-shaped { created, data: [{ b64_json | url }] }.
  normalize: (responseBody, prompt) => {
    if (responseBody?.created && Array.isArray(responseBody?.data)) return responseBody;
    const data = (Array.isArray(responseBody?.data) ? responseBody.data : []).map((item) =>
      typeof item === "string"
        ? (/^https?:\/\//i.test(item) ? { url: item } : { b64_json: item })
        : item
    );
    return { created: responseBody?.created ?? nowSec(), data, revised_prompt: prompt };
  },
};