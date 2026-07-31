// Custom user-defined system prompt injector.
// Injects user's custom prompt text into the system message before dispatch.

import { injectSystemPrompt } from "./systemInject.js";

export function injectCustomPrompt(body, format, prompt) {
  injectSystemPrompt(body, format, prompt);
}
