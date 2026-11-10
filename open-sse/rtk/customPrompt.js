// Custom system prompt injector: appends a user-authored instruction into the
// system message of the final request body, just before dispatch.
//
// Independent of the built-in savers (caveman, ponytail): it has its own toggle
// and text, so it works whether or not those are enabled.

import { injectSystemPrompt } from "./systemInject.js";

export const MAX_COMBO_PROMPT_CHARS = 8000;
const COMBO_PROMPT_SEP = "\n\n";

/**
 * Resolve the system prompt a combo adds to its members' requests. Accepts the
 * prompts of the enclosing combos, outermost first (a nested combo inherits its
 * parent's prompt), and returns them trimmed, capped and joined; "" when none.
 *
 * @param {...string} prompts - Per-combo system prompts, outermost first
 * @returns {string} Combined prompt
 */
export function resolveComboPrompt(...prompts) {
  return prompts
    .map((p) => (typeof p === "string" ? p.trim().slice(0, MAX_COMBO_PROMPT_CHARS) : ""))
    .filter(Boolean)
    .join(COMBO_PROMPT_SEP);
}

export function injectCustomPrompt(body, format, text) {
  if (typeof text !== "string" || !text.trim()) return false;
  injectSystemPrompt(body, format, text);
  return true;
}
