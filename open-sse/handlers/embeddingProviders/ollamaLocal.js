import { resolveOllamaLocalHost } from "../../config/providers.js";

export default {
  buildUrl: (_model, creds) => {
    const rawHost = resolveOllamaLocalHost(creds);
    const host = String(rawHost || "")
      .replace(/\/+$/, "")
      .replace(/\/v1\/embeddings$/, "")
      .replace(/\/v1$/, "");
    return `${host}/v1/embeddings`;
  },
  buildHeaders: (creds) => {
    const headers = {
      "Content-Type": "application/json",
    };
    if (creds?.apiKey) {
      headers["Authorization"] = `Bearer ${creds.apiKey}`;
    }
    return headers;
  },
  buildBody: (model, { input, encoding_format, dimensions }) => {
    const body = { model, input };
    if (encoding_format) body.encoding_format = encoding_format;
    if (dimensions != null && dimensions !== "") {
      const dim = Number(dimensions);
      if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
    }
    return body;
  },
  normalize: (responseBody) => responseBody,
};
