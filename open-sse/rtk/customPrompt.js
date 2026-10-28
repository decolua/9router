// Custom system prompt injector: appends a user-authored instruction into the
// system message of the final request body, just before dispatch.
//
// Independent of the built-in savers (caveman, ponytail): it has its own toggle
// and text, so it works whether or not those are enabled.

import { injectSystemPrompt } from "./systemInject.js";

export function injectCustomPrompt(body, format, text) {
  if (typeof text !== "string" || !text.trim()) return false;
  injectSystemPrompt(body, format, text);
  return true;
}
