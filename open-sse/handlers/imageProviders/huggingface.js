// HuggingFace Inference Providers router — returns binary image
//
// The router is a switchboard in front of many inference providers and is
// addressed as `<baseUrl>/<provider>/<providerModelId>`. `providerModelId` is
// the id the *provider* uses, which is not the Hub model id, so it is resolved
// through `imageConfig.modelMap` (built from the Hub API's
// inferenceProviderMapping and limited to providers the router forwards to).
//
// The legacy `api-inference.huggingface.co` host is gone (DNS ENOTFOUND) and is
// deliberately not referenced anywhere here.
import { nowSec, urlToBase64 } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageConfig = () => PROVIDER_MEDIA["huggingface"]?.imageConfig || {};
const BASE_URL = imageConfig().baseUrl;
const MODEL_MAP = imageConfig().modelMap || {};

// A plain-object lookup returns inherited truthy values for keys like "toString" or
// "constructor", which would build nonsense URLs. Resolve own keys only.
const lookup = (model) => (Object.hasOwn(MODEL_MAP, model) ? MODEL_MAP[model] : undefined);

// modelMap values are either a bare path (text-to-image) or { path, task }.
const mappingPath = (entry) => (typeof entry === "string" ? entry : entry.path);
const mappingTask = (entry) => (typeof entry === "string" ? "text-to-image" : entry.task || "text-to-image");

// A connection may point at its own endpoint (self-hosted Text Generation
// Inference / TGI container). That endpoint already knows its own model ids, so
// the router mapping does not apply and the Hub id is passed through verbatim.
function customBaseUrl(creds) {
  const url = creds?.providerSpecificData?.baseUrl;
  return typeof url === "string" && url.trim() ? url.trim().replace(/\/+$/, "") : null;
}

// The router's image-to-image payload wants raw base64 — not a data URL, not a URL.
// Accept every shape our own callers use (data URL, bare base64, remote URL, array).
async function sourceImage(body) {
  const raw = body?.image || (Array.isArray(body?.images) ? body.images[0] : null);
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return await urlToBase64(value);
  const match = /^data:image\/[^;]+;base64,(.+)$/i.exec(value);
  return match ? match[1] : value;
}

export default {
  buildUrl: (model, creds) => {
    const override = customBaseUrl(creds);
    if (override) {
      // The model id is client-controlled; on a custom endpoint it lands in a URL
      // path verbatim, so reject traversal/query injection (mirrors sttCore's guard).
      if (model.includes("..") || model.includes("//") || /[?#]/.test(model)) {
        throw new Error(`HuggingFace: invalid model ID "${model}"`);
      }
      return `${override}/${model}`;
    }

    const entry = lookup(model);
    if (!entry) {
      throw new Error(
        `HuggingFace: no HuggingFace router mapping for model "${model}". ` +
          `Add it to imageConfig.modelMap in open-sse/providers/registry/huggingface.js, ` +
          `or set a custom base URL on the connection.`
      );
    }
    return `${BASE_URL}/${mappingPath(entry)}`;
  },
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: async (model, body) => {
    const entry = lookup(model);
    const task = mappingTask(entry || "");

    if (task === "image-to-image") {
      const image = await sourceImage(body);
      if (!image) {
        throw new Error(
          `HuggingFace: model "${model}" requires a source image. ` +
            `Send it as "image" (or "images") in the request body.`
        );
      }
      // inputs carries the source image; the prompt moves under parameters.
      return { inputs: image, parameters: { prompt: body.prompt } };
    }

    return { inputs: body.prompt };
  },
  // HF returns raw image bytes — convert to b64_json
  async parseResponse(response) {
    const buf = await response.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { created: nowSec(), data: [{ b64_json: base64 }] };
  },
  normalize: (responseBody) => responseBody,
};
