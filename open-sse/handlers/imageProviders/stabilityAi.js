// Stability AI v2 — sync, returns { image: "<b64>" }
import { nowSec, sizeToAspectRatio } from "./_base.js";

const BASE_URL = "https://api.stability.ai/v2beta/stable-image/generate";

// Map model id → endpoint segment
function modelToEndpoint(model) {
  if (model.includes("ultra")) return "ultra";
  if (model.includes("sd3")) return "sd3";
  return "core";
}

export default {
  buildUrl: (model) => `${BASE_URL}/${modelToEndpoint(model)}`,
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "Accept": "application/json",
    };
  },
  buildBody: (model, body) => {
    const req = { prompt: body.prompt, output_format: (body.output_format || "png").toLowerCase() };
    if (body.size) req.aspect_ratio = sizeToAspectRatio(body.size);
    if (body.style) req.style_preset = body.style;
    if (model.includes("sd3")) req.model = model;
    return req;
  },
  normalize: (responseBody) => {
    if (responseBody.image) return { created: nowSec(), data: [{ b64_json: responseBody.image }] };
    return { created: nowSec(), data: [] };
  },
};
