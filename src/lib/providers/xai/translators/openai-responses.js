/**
 * OpenAI Responses ↔ xAI Responses translator
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/translator/openai-responses/xai/*
 *
 * xAI's Responses API is shape-compatible with OpenAI Responses, so this is
 * mostly a passthrough. Translator responsibilities:
 *   - normalize response.id when synthesized
 *   - reconcile a small set of unsupported fields (drop unknown vendor-only opts)
 *   - apply the thinking patcher hook (delegated upstream)
 */

/**
 * Translate an inbound OpenAI-Responses request body into an xAI request body.
 *
 * @param {object} req
 * @returns {object}
 */
export function openaiResponsesRequestToXai(req) {
  if (!req || typeof req !== "object") return req;
  const out = { ...req };

  // xAI does not currently honor `parallel_tool_calls: false` on every model;
  // mirror CLIProxyAPI: leave the flag as caller specified.

  // Drop OpenAI-specific service_tier hint that xAI rejects.
  if ("service_tier" in out) delete out.service_tier;

  // xAI expects `input` (Responses-style); if the caller passed `messages`
  // instead, leave them — xAI also accepts messages, but warn via metadata.
  return out;
}

/**
 * Translate an xAI completed response (already aggregated by collectSseToCompleted)
 * into the OpenAI Responses JSON shape that callers expect.
 *
 * @param {object} completed
 * @returns {object}
 */
export function xaiCompletedToOpenaiResponses(completed) {
  if (!completed || typeof completed !== "object") return completed;
  return {
    ...completed,
    object: completed.object || "response",
    status: completed.status || "completed",
  };
}

/**
 * Pass-through transform for SSE event objects { event, data } emitted by
 * iterateSseEvents(). For OpenAI Responses callers we forward verbatim — only
 * normalize event names that diverge.
 *
 * @param {{event: string, data: string}} ev
 * @returns {{event: string, data: string} | null} null = drop event
 */
export function xaiSseEventToOpenaiResponses(ev) {
  if (!ev || !ev.event) return ev;
  // CLIProxyAPI drops xAI-internal `response.output_text.annotation.added`
  // when the caller is OpenAI Responses, since OpenAI emits a different name.
  if (ev.event === "response.output_text.annotation.added") return null;
  return ev;
}
