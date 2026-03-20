/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

// Maximum delay (ms) to wait before retrying a transiently failed model
const COMBO_RETRY_MAX_DELAY_MS = 10_000;
// Maximum number of retries per model for transient errors
const COMBO_RETRY_MAX_ATTEMPTS = 2;

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;

  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);

  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Extract retry delay in milliseconds from a failed response.
 * Checks both the Retry-After header and the JSON body's retryAfter field.
 * @param {Response} result - The failed response
 * @returns {Promise<number|null>} Delay in ms, or null if not retryable
 */
async function extractRetryDelayMs(result) {
  // Check Retry-After header first (value in seconds)
  const retryAfterHeader = result.headers?.get?.("Retry-After");
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  // Check JSON body for retryAfter (ISO timestamp)
  try {
    const errorBody = await result.clone().json();
    const retryAfter = errorBody?.retryAfter;
    if (retryAfter) {
      const delayMs = new Date(retryAfter).getTime() - Date.now();
      if (delayMs > 0) return delayMs;
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log }) {
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < models.length; i++) {
    const modelStr = models[i];
    let retryAttempt = 0;

    while (retryAttempt <= COMBO_RETRY_MAX_ATTEMPTS) {
      const attemptLabel = retryAttempt > 0
        ? `Retrying model ${i + 1}/${models.length}: ${modelStr} (attempt ${retryAttempt + 1})`
        : `Trying model ${i + 1}/${models.length}: ${modelStr}`;
      log.info("COMBO", attemptLabel);

      try {
        const result = await handleSingleModel(body, modelStr);

        // Success (2xx) - return response
        if (result.ok) {
          log.info("COMBO", `Model ${modelStr} succeeded`);
          return result;
        }

        // Extract retry delay for potential transient retry
        const retryDelayMs = await extractRetryDelayMs(result);

        // Extract error info from response
        let errorText = result.statusText || "";
        let retryAfter = null;
        try {
          const errorBody = await result.clone().json();
          errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
          retryAfter = errorBody?.retryAfter || null;
        } catch {
          // Ignore JSON parse errors
        }

        // Track earliest retryAfter across all combo models
        if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
          earliestRetryAfter = retryAfter;
        }

        // Normalize error text to string (Worker-safe)
        if (typeof errorText !== "string") {
          try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
        }

        // Check if should fallback to next model
        const { shouldFallback } = checkFallbackError(result.status, errorText);

        if (!shouldFallback) {
          log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
          return result;
        }

        // If the retry delay is short enough, wait and retry the same model
        if (
          retryDelayMs &&
          retryDelayMs <= COMBO_RETRY_MAX_DELAY_MS &&
          retryAttempt < COMBO_RETRY_MAX_ATTEMPTS
        ) {
          log.info("COMBO", `Model ${modelStr} temporarily unavailable, retrying in ${Math.ceil(retryDelayMs / 1000)}s`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          retryAttempt++;
          continue;
        }

        // Fallback to next model
        lastError = errorText || String(result.status);
        if (!lastStatus) lastStatus = result.status;
        log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
        break;
      } catch (error) {
        // Catch unexpected exceptions to ensure fallback continues
        lastError = error.message || String(error);
        if (!lastStatus) lastStatus = 500;
        log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
        break;
      }
    }
  }

  // All models failed
  const status =  406;
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
