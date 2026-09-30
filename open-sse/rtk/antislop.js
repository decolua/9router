// Antislop injector: appends an anti-slop instruction into the system message
// of the final request body, just before dispatch to the provider executor.

import { injectSystemPrompt } from "./systemInject.js";
import { ANTISLOP_PROMPTS } from "./antislopPrompts.js";

export function injectAntislop(body, format, scope) {
  injectSystemPrompt(body, format, ANTISLOP_PROMPTS[scope]);
}
