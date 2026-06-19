// ComfyUI — local, noAuth (placeholder; full graph workflow not implemented)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["comfyui"]?.imageConfig?.baseUrl;

export default {
  noAuth: true,
  buildUrl: () => BASE_URL,
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model, body) => ({ prompt: body.prompt }),
  normalize: (responseBody) => responseBody,
};
