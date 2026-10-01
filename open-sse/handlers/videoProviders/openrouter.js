// OpenRouter video jobs — https://openrouter.ai/docs/api/api-reference/videos
//
// Same async shape as xAI (POST → { id, status }, GET → status/unsigned_urls),
// two differences only: creation POSTs to the collection root (no `/generations`
// suffix) and the account headers come from the registry entry.
// Response bodies are passed through verbatim.

// ponytail: generations only — OpenRouter has no edits/extensions endpoint today.
const SUPPORTED_ACTIONS = new Set(["generations"]);

function headers(config, token) {
  return {
    Accept: "application/json",
    ...(config.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default {
  // GET /videos/{id}/content?index=N — the finished bytes. OpenRouter's
  // `unsigned_urls` still require the account key, so the proxy fetches them
  // on the client's behalf rather than handing the upstream key out.
  buildContentRequest({ config, requestId, index, token }) {
    const base = config.baseUrl.replace(/\/$/, "");
    const query = Number.isInteger(index) && index > 0 ? `?index=${index}` : "";
    return {
      method: "GET",
      url: `${base}/${encodeURIComponent(requestId)}/content${query}`,
      headers: { ...(config.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
  },

  buildRequest({ config, action, requestId, rawBody, contentType, token }) {
    const base = config.baseUrl.replace(/\/$/, "");

    if (requestId) {
      return { method: "GET", url: `${base}/${encodeURIComponent(requestId)}`, headers: headers(config, token) };
    }
    if (!SUPPORTED_ACTIONS.has(action)) {
      return { error: `OpenRouter video supports 'generations' only (got '${action}')` };
    }
    if (contentType && !contentType.includes("application/json")) {
      return { error: "OpenRouter video requires an application/json body" };
    }
    return {
      method: "POST",
      url: base,
      headers: { ...headers(config, token), "Content-Type": "application/json" },
      body: rawBody,
    };
  },
};
