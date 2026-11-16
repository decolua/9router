/**
 * Per-model reasoning effort.
 *
 * `settings.providerThinking[provider]` is `{ mode, models }`. `mode` is one value
 * for every model of the provider, and only fills in an effort the client did not
 * send (chatCore). `models` maps a model id to the effort that model should run
 * at: the operator's explicit choice for that model, so it is applied over the
 * client's — an agent client sends an effort of its own on every request, and a
 * setting that only filled gaps would never take effect for it.
 *
 * An effort written into the request's model id (`gpt-6-luna-low`, `gpt-6-luna(low)`)
 * is still stronger than this: it is the choice made for that one request.
 */
import { getThinkingLevels } from "../providers/thinkingLevels.js";

/** The level configured for this model, if it is one the model takes; otherwise null. */
export function modelEffortFor(provider, model, providerThinking) {
  const level = providerThinking?.models?.[model];
  if (typeof level !== "string" || !level || level === "auto") return null;
  const levels = getThinkingLevels(provider, model);
  return levels?.includes(level) ? level : null;
}

/**
 * The body with this model's configured effort applied, or the same body when
 * there is none. Written where the body's own format reads it:
 *   claude  → output_config.effort. reasoning_effort is not a Messages API field
 *             (a passthrough would send it upstream verbatim), and thinkingUnified
 *             reads output_config.effort first, so a Claude client keeps its own
 *             unless that is overwritten.
 *   gemini  → left alone: thinkingConfig is a budget, not a named effort.
 *   other   → reasoning_effort / reasoning.effort.
 */
export function applyModelEffort(body, provider, model, providerThinking, sourceFormat = null) {
  const effort = modelEffortFor(provider, model, providerThinking);
  if (!effort) return body;
  if (sourceFormat === "claude") return { ...body, output_config: { ...(body.output_config || {}), effort } };
  if (sourceFormat === "gemini" || sourceFormat === "gemini-cli" || sourceFormat === "antigravity") return body;
  const next = { ...body, reasoning_effort: effort };
  if (body.reasoning && typeof body.reasoning === "object") {
    next.reasoning = { ...body.reasoning, effort };
  }
  return next;
}
