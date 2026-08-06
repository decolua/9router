// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai.js";
import { mergeClientIdentityHeaders } from "../../shared/clientIdentityHeaders.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = rawBaseUrl.replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
  buildHeaders: (creds) => mergeClientIdentityHeaders(
    { "Content-Type": "application/json" },
    creds?.providerSpecificData || {},
    { "Authorization": `Bearer ${creds?.apiKey || creds?.accessToken}` },
  ),
};
