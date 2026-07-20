function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildNonJsonError(response, fallbackMessage, text) {
  const statusText = collapseWhitespace(response?.statusText);
  const status = response?.status ? `HTTP ${response.status}` : "non-JSON response";
  const snippet = collapseWhitespace(text).slice(0, 160);
  const detail = [status, statusText].filter(Boolean).join(" ");
  return `${fallbackMessage}: ${detail}${snippet ? ` - ${snippet}` : ""}`;
}

export async function readJsonResponse(response, fallbackMessage = "Request failed") {
  const text = await response.text().catch(() => "");
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: buildNonJsonError(response, fallbackMessage, text) };
  }
}
