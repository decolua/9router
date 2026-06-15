// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)

const ENDPOINTS = {
  openai: "https://api.openai.com/v1/images/generations",
  minimax: "https://api.minimaxi.com/v1/images/generations",
  openrouter: "https://openrouter.ai/api/v1/images/generations",
  recraft: "https://external.api.recraft.ai/v1/images/generations",
  "vercel-ai-gateway": "https://ai-gateway.vercel.sh/v1/images/generations",
  xai: "https://api.x.ai/v1/images/generations",
};

export default function createOpenAIAdapter(providerId) {
  return {
    buildUrl: () => ENDPOINTS[providerId],
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json" };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      if (providerId === "openrouter") {
        headers["HTTP-Referer"] = "https://endpoint-proxy.local";
        headers["X-Title"] = "Endpoint Proxy";
      }
      return headers;
    },
    buildBody: (model, body) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      // xAI only accepts prompt, model, n, response_format
      if (providerId === "xai") {
        const req = { model, prompt, n };
        if (response_format) req.response_format = response_format;
        return req;
      }
      const req = { model, prompt, n, size };
      if (quality) req.quality = quality;
      if (style) req.style = style;
      if (response_format) req.response_format = response_format;
      return req;
    },
    normalize: (responseBody) => responseBody,
  };
}
