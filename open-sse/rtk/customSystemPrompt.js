// Custom system prompt injector: appends user-defined system prompt into the
// system message of the final request body, just before dispatch to the provider executor.

import { injectSystemPrompt } from "./systemInject.js";

export function injectCustomSystemPrompt(body, format, prompt) {
  injectSystemPrompt(body, format, prompt);
}