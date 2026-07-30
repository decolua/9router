import { resolveOllamaLocalHost } from "../../config/providers.js";

export default {
  buildUrl: (_model, creds) => {
    const host = (resolveOllamaLocalHost(creds) || "").replace(/\/+$/, "");
    return `${host}/v1/embeddings`;
  },
  buildHeaders: () => ({
    "Content-Type": "application/json",
  }),
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
