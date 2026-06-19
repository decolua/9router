// Ponytail injector: tail-focus ruleset appended into the system message.
// Composes AFTER caveman so the model is both terse (caveman) and tail-focused
// (ponytail). Both share ./systemInject.js so a single parsed body is reused —
// no double parse/serialize.

import { PONYTAIL_PROMPTS } from "./ponytailPrompts.js";
import { injectSystem } from "./systemInject.js";

export function injectPonytail(body, format, level) {
  const prompt = PONYTAIL_PROMPTS[level];
  if (!body || !prompt) return;
  injectSystem(body, format, prompt);
}
