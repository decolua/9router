// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai.js";
import { applyCustomHeaders } from "../../utils/customHeaders.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = rawBaseUrl.replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
  buildHeaders: (creds) => {
    const headers = baseAdapter.buildHeaders(creds);
    applyCustomHeaders(headers, creds?.providerSpecificData?.customHeaders || creds?.customHeaders, creds);
    return headers;
  },
};
