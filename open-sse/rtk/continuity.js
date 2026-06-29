import { injectSystemPrompt } from "./systemInject.js";
import { buildContinuityPrompt } from "./continuityPrompt.js";

export function injectContinuity(body, format, recentThoughts) {
  const framedContext = buildContinuityPrompt(recentThoughts);
  if (!framedContext) return;
  injectSystemPrompt(body, format, framedContext);
}
