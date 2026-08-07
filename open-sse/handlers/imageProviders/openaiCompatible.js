// OpenAI-compatible custom-node image adapter (for user-defined openai-compatible nodes)
// Uses the node's own baseUrl + /images/generations, Bearer apiKey, passthrough body.
// Supports URL reference images via `image` / `images` array (gpt-image style), matching pi-image.

export default function createOpenAICompatibleAdapter() {
  return {
    noAuth: false,

    buildUrl: (_model, credentials) => {
      const base = credentials?.providerSpecificData?.baseUrl || credentials?.baseUrl;
      if (!base) throw new Error("No baseUrl for openai-compatible image node");
      return `${base.replace(/\/+$/, "")}/images/generations`;
    },

    buildHeaders: (credentials) => {
      const headers = { "Content-Type": "application/json" };
      const key = credentials?.apiKey || credentials?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },

    buildBody: (model, body) => {
      const { prompt, n = 1, size, quality, style, response_format, image_detail, background, output_format } = body;
      const full = { model, prompt, n };
      if (size) full.size = size;
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      if (image_detail) full.image_detail = image_detail;
      if (background) full.background = background;
      if (output_format) full.output_format = output_format;

      // Reference images (pi-image compatibility): `image` (string) or `images` (array of URLs/dataURIs)
      const refs = body.image || body.images || body.image_url || body.image_urls;
      if (typeof refs === "string") full.image = [refs];
      else if (Array.isArray(refs) && refs.length > 0) full.image = refs;

      return full;
    },

    normalize: (responseBody) => responseBody,
  };
}
