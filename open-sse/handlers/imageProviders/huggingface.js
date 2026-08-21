// HuggingFace Inference API — returns binary image
import { nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["huggingface"]?.imageConfig?.baseUrl;

export default {
  buildUrl: (model) => `${BASE_URL}/${model}`,
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
