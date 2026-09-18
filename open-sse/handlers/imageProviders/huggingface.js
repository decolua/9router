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
import { nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageConfig = () => PROVIDER_MEDIA["huggingface"]?.imageConfig || {};
const BASE_URL = imageConfig().baseUrl;
const MODEL_MAP = imageConfig().modelMap || {};

// A connection may point at its own endpoint (self-hosted Text Generation
// Inference / TGI container). That endpoint already knows its own model ids, so
// the router mapping does not apply and the Hub id is passed through verbatim.
function customBaseUrl(creds) {
  const url = creds?.providerSpecificData?.baseUrl;
  return typeof url === "string" && url.trim() ? url.trim().replace(/\/+$/, "") : null;
}

export default {
  buildUrl: (model, creds) => {
    const override = customBaseUrl(creds);
    if (override) return `${override}/${model}`;

    const resolved = MODEL_MAP[model];
    if (!resolved) {
      throw new Error(
        `HuggingFace: no HuggingFace router mapping for model "${model}". ` +
          `Add it to imageConfig.modelMap in open-sse/providers/registry/huggingface.js, ` +
          `or set a custom base URL on the connection.`
      );
    }
    return `${BASE_URL}/${resolved}`;
  },
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (_model, body) => ({ inputs: body.prompt }),
  // HF returns raw image bytes — convert to b64_json
  async parseResponse(response) {
    const buf = await response.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { created: nowSec(), data: [{ b64_json: base64 }] };
  },
  normalize: (responseBody) => responseBody,
};
