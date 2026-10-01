// Antislop injectors: append anti-slop instructions into the system message
// of the final request body, just before dispatch to the provider executor.
// Two independent toggles; both on injects both (stacking is idempotent).

import { injectSystemPrompt } from "./systemInject.js";
import { ANTISLOP_UI_PROMPT, ANTISLOP_COPY_HUMAN_PROMPT } from "./antislopPrompts.js";

export function injectAntislopUi(body, format) {
  injectSystemPrompt(body, format, ANTISLOP_UI_PROMPT);
}

export function injectAntislopCopyHuman(body, format) {
  injectSystemPrompt(body, format, ANTISLOP_COPY_HUMAN_PROMPT);
}
