function normalizeUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export function canonicalEndpoint(value, suffix) {
  const endpoint = normalizeUrl(value);
  if (!endpoint || endpoint.endsWith(suffix)) return endpoint;
  return `${endpoint}${suffix}`;
}

export function openAIEndpoints(value) {
  let baseUrl = normalizeUrl(value);
  for (const suffix of ["/chat/completions", "/responses"]) {
    if (baseUrl.endsWith(suffix)) {
      baseUrl = baseUrl.slice(0, -suffix.length);
      break;
    }
  }
  return {
    baseUrl,
    chatUrl: baseUrl ? `${baseUrl}/chat/completions` : "",
    responsesUrl: baseUrl ? `${baseUrl}/responses` : "",
  };
}
