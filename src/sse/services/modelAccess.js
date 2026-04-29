import { parseModel } from "open-sse/services/model.js";
import { getModelInfo } from "./model.js";

/**
 * Normalize a model string to canonical "providerId/model" form.
 * Handles provider aliases like "cc/" → "claude/".
 * Returns the original string if it has no "/" (combo name, bare alias).
 */
function normalizeModelStr(str) {
  if (!str || !str.includes("/")) return str;
  const parsed = parseModel(str);
  if (parsed.provider) {
    return `${parsed.provider}/${parsed.model}`;
  }
  return str;
}

/**
 * Check if a model string matches any entry in the allowedModels list.
 * Supports:
 * - Exact match (after normalization)
 * - Wildcard: "provider/*" matches all models of that provider
 * - Alias resolution: resolves aliases/combos and checks resolved form
 *
 * @param {string} modelStr - The model string from the request
 * @param {string[]} allowedModels - The allowed models list from the API key record
 * @returns {Promise<boolean>}
 */
export async function isModelAllowed(modelStr, allowedModels) {
  // Empty or missing = all allowed
  if (!allowedModels || allowedModels.length === 0) return true;

  const normalizedRequest = normalizeModelStr(modelStr);

  // Normalize allowedModels entries once
  const normalizedAllowed = allowedModels.map(entry => normalizeModelStr(entry));

  // 1. Direct match (normalized)
  if (normalizedAllowed.includes(normalizedRequest)) return true;

  // 2. Wildcard match: "provider/*" patterns
  for (const pattern of normalizedAllowed) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // "openai/"
      if (normalizedRequest.startsWith(prefix)) return true;
    }
  }

  // 3. Resolve alias and check the resolved form
  try {
    const modelInfo = await getModelInfo(modelStr);
    if (modelInfo.provider && modelInfo.model) {
      const resolved = `${modelInfo.provider}/${modelInfo.model}`;
      if (resolved !== normalizedRequest) {
        // Check resolved form against exact matches
        if (normalizedAllowed.includes(resolved)) return true;
        // Check resolved form against wildcards
        for (const pattern of normalizedAllowed) {
          if (pattern.endsWith("/*")) {
            const prefix = pattern.slice(0, -1);
            if (resolved.startsWith(prefix)) return true;
          }
        }
      }
    }
  } catch {
    // If resolution fails, deny access
  }

  return false;
}
