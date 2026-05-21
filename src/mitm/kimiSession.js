/**
 * Request shaping for the Kimi Code (`kimi-coding`) provider.
 *
 * Two responsibilities:
 *
 * 1. scrubKimiRequestBody(body): remove Anthropic-only fields that Kimi rejects
 *    with the misleading "Not found the model kimi-for-coding" 404.
 *
 * 2. rewriteKimiThinkingVariant(body): translate the virtual model id
 *    `kimi-k2.6-thinking` into a real upstream `kimi-k2.6` request with
 *    `thinking:{type:"enabled"}` and `reasoning_effort:"high"` injected.
 */

const ANTHROPIC_ONLY_FIELDS = ["metadata", "thinking", "context_management", "output_config"];

export function scrubKimiRequestBody(body) {
  if (!body || typeof body !== "object") return body;
  for (const field of ANTHROPIC_ONLY_FIELDS) {
    if (field in body) delete body[field];
  }
  return body;
}

export function rewriteKimiThinkingVariant(body) {
  if (!body || typeof body !== "object") return body;
  if (body.model !== "kimi-k2.6-thinking") return body;

  body.model = "kimi-k2.6";
  body.thinking = { type: "enabled" };
  body.reasoning_effort = "high";
  return body;
}

/**
 * Apply both transforms in the correct order for a kimi-coding request.
 * Pass the parsed JSON body before forwarding to api.kimi.com/coding/v1/messages.
 *
 * Order matters: rewrite first so the scrub does not strip a `thinking` field
 * that the rewrite just added.
 */
export function prepareKimiRequestBody(body) {
  if (!body || typeof body !== "object") return body;

  const wasThinkingVariant = body.model === "kimi-k2.6-thinking";
  rewriteKimiThinkingVariant(body);

  if (!wasThinkingVariant) {
    scrubKimiRequestBody(body);
  } else {
    // For the thinking variant, only strip the fields the rewrite did not set.
    for (const field of ANTHROPIC_ONLY_FIELDS) {
      if (field === "thinking") continue;
      if (field in body) delete body[field];
    }
  }
  return body;
}
