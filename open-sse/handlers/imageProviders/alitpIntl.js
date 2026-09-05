// Alibaba Token Plan images (wan2.7-image*) — compatible-mode has no
// /images/generations, so this uses DashScope multimodal-generation on the
// plan's own host. Sizes are "W*H", and results are expiring signed OSS URLs.
import { nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["alitp-intl"]?.imageConfig?.baseUrl;

const OPTIONAL_PARAMETERS = ["negative_prompt", "seed", "prompt_extend", "watermark"];

function toDashScopeSize(size) {
  const value = String(size || "").trim();
  if (!value || value === "auto") return null;
  const match = /^(\d+)\s*[x*×]\s*(\d+)$/i.exec(value);
  return match ? `${match[1]}*${match[2]}` : null;
}

function collectImages(node, out) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectImages(item, out);
    return out;
  }
  if (typeof node === "object") {
    const image = node.image || node.url || node.image_url;
    if (typeof image === "string" && image) out.push(image);
    return out;
  }
  return out;
}

function normalizeTokenPlanResponse(responseBody) {
  if (responseBody?.created && Array.isArray(responseBody?.data)) return responseBody;

  const choices = responseBody?.output?.choices;
  const urls = [];
  if (Array.isArray(choices)) {
    for (const choice of choices) collectImages(choice?.message?.content, urls);
  }
  // Some DashScope image models answer with output.results instead of choices.
  if (!urls.length) collectImages(responseBody?.output?.results, urls);

  return {
    created: nowSec(),
    data: urls.map((url) => (
      /^https?:\/\//i.test(url) ? { url } : { b64_json: url.replace(/^data:image\/[^;]+;base64,/i, "") }
    )),
  };
}

export default {
  buildUrl: () => {
    if (!BASE_URL) throw new Error("alitp-intl image endpoint is not configured");
    return BASE_URL;
  },

  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  },

  buildBody: (model, body) => {
    const parameters = {};
    const size = toDashScopeSize(body?.size);
    if (size) parameters.size = size;
    const n = Number(body?.n);
    if (Number.isFinite(n) && n > 0) parameters.n = Math.min(Math.trunc(n), 4);
    for (const field of OPTIONAL_PARAMETERS) {
      if (body?.[field] !== undefined) parameters[field] = body[field];
    }

    return {
      model,
      input: {
        messages: [{ role: "user", content: [{ text: body.prompt }] }],
      },
      ...(Object.keys(parameters).length ? { parameters } : {}),
    };
  },

  normalize: normalizeTokenPlanResponse,
};
