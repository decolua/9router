import { getApiKeyByKey } from "@/lib/localDb";
import { extractApiKey } from "./auth.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

/**
 * Check if a model is allowed by the API key policy.
 * Empty allowedModels = all models allowed.
 * Exact match against the requested model string.
 *
 * @param {{ allowedModels?: string[] } | null} policy
 * @param {string} modelStr
 * @returns {boolean}
 */
export function isModelAllowed(policy, modelStr) {
  if (!policy || !policy.allowedModels || policy.allowedModels.length === 0) {
    return true;
  }
  return policy.allowedModels.includes(modelStr);
}

/**
 * Enforce API key model policy on a request.
 *
 * Call this AFTER the existing requireApiKey/isValidApiKey check.
 * If no API key is provided, returns null (allow — requireApiKey handles that case).
 * If the key has no policy or an empty allowedModels list, returns null (allow all).
 * If the model is not in the allowlist, returns a 403 error Response.
 *
 * @param {Request} request
 * @param {string} modelStr - The model string from the request body
 * @returns {Promise<Response | null>} null if allowed, error Response if rejected
 */
export async function enforceApiKeyModelPolicy(request, modelStr) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return null;

  const keyRecord = await getApiKeyByKey(apiKey);
  if (!keyRecord || !keyRecord.isActive) return null;

  if (!isModelAllowed(keyRecord.policy, modelStr)) {
    log.warn("AUTH", `Model "${modelStr}" not allowed for API key "${keyRecord.name}"`);
    return errorResponse(
      HTTP_STATUS.FORBIDDEN,
      `Model "${modelStr}" is not allowed for this API key`
    );
  }

  return null;
}
