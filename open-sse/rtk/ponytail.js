// Ponytail injector: appends a "lazy senior dev / write minimal code" instruction
// into the system message of the final request body, just before it is dispatched
// to the provider executor. Format-aware injection lives in the shared
// systemInject helper (same as caveman).

import { injectSystemPrompt } from "./systemInject.js";
import { PONYTAIL_PROMPTS } from "./ponytailPrompts.js";

export function injectPonytail(body, format, level) {
  injectSystemPrompt(body, format, PONYTAIL_PROMPTS[level]);
}
