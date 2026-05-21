/**
 * Collapse Anthropic API version to a single lowercase header. Config may set
 * `Anthropic-Version` while callers add `anthropic-version`; some stacks merge
 * both into one invalid comma-separated value (e.g. "2023-06-01, 2023-06-01").
 */
export function normalizeAnthropicVersionHeader(headers) {
  if (!headers || typeof headers !== "object") return;
  const av = headers["anthropic-version"] ?? headers["Anthropic-Version"];
  if (av == null || String(av).trim() === "") return;
  const first = String(av).split(",")[0].trim();
  headers["anthropic-version"] = first || "2023-06-01";
  delete headers["Anthropic-Version"];
}
