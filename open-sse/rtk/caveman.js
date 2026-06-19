// Caveman injector: appends a caveman-style instruction into the system message
// of the final request body, just before it is dispatched to the provider executor.
// Dispatches by format so it works for both translated and native-passthrough flows.
//
// Format-aware injection lives in ./systemInject.js and is shared with ponytail
// so the two savers compose on one parsed body.

import { CAVEMAN_PROMPTS } from "./cavemanPrompts.js";
import { injectSystem } from "./systemInject.js";

export function injectCaveman(body, format, level) {
  const prompt = CAVEMAN_PROMPTS[level];
  if (!body || !prompt) return;
  injectSystem(body, format, prompt);
}
