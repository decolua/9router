/**
 * CodeBuddy protocol public surface. Executors stay thin while request and
 * response wire rules remain centralized here.
 */

export { sanitizeChatBody } from "./request.js";
export { createSseNormalizeTransform } from "./response.js";
