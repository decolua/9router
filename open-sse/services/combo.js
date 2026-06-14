/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

function readRotationState(rotationKey) {
  const existing = comboRotationState.get(rotationKey);
  if (typeof existing === "number") return { index: existing, consecutiveUseCount: 0 };
  return existing || { index: 0, consecutiveUseCount: 0 };
}

/**
 * Peek the next index that getRotatedModels would use without mutating state.
 * Used by handleComboChat so it can correct rotation after a fallback hop.
 *
 * @param {string} comboName
 * @param {number} modelsLength
 * @param {string} strategy
 * @returns {number} 0-based absolute index into the original models array
 */
export function peekRotationIndex(comboName, modelsLength, strategy) {
  if (!modelsLength || modelsLength <= 0 || strategy !== "round-robin") return 0;
  const rotationKey = comboName || "__default__";
  const state = readRotationState(rotationKey);
  return state.index % modelsLength;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const state = readRotationState(rotationKey);

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Override rotation state after a fallback hop served the request from a model
 * other than the originally-selected one. Without this, the pointer advance
 * baked into getRotatedModels (which assumes models[currentIndex] served the
 * request) leaves the next request landing on the same fallback model again,
 * defeating round-robin distribution.
 *
 * Sticky budget is reset to 0 because the originally-planned model is unhealthy.
 * Spending more sticky requests on a model that just failed wastes the budget
 * on a guaranteed-failing path.
 *
 * @param {string} comboName
 * @param {number} currentIndex - The index that was peeked before getRotatedModels ran
 * @param {number} usedRelativeIndex - Position in the rotated array of the model that succeeded (>0 means fallback occurred)
 * @param {number} modelsLength
 */
export function commitRotationAfterFallback(comboName, currentIndex, usedRelativeIndex, modelsLength) {
  if (!modelsLength || modelsLength <= 0) return;
  const rotationKey = comboName || "__default__";
  const usedAbsoluteIndex = (currentIndex + usedRelativeIndex) % modelsLength;
  comboRotationState.set(rotationKey, {
    index: (usedAbsoluteIndex + 1) % modelsLength,
    consecutiveUseCount: 0,
  });
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

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
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1 }) {
  // Snapshot the rotation pointer BEFORE getRotatedModels advances it. Needed
  // so we can correct the pointer if a fallback hop ends up serving from a
  // different model than originally selected.
  const isRotating = comboStrategy === "round-robin" && models && models.length > 1;
  const currentIndex = isRotating ? peekRotationIndex(comboName, models.length, comboStrategy) : 0;

  // Apply rotation strategy if enabled
  const rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);

      // Success (2xx) - return response
      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        // Fallback hop succeeded. Advance rotation past the model that actually
        // served the request so the next call skips it instead of immediately
        // re-trying the same fallback model. Skipped when i === 0 because
        // getRotatedModels already advanced correctly for that case.
        if (isRotating && i > 0) {
          commitRotationAfterFallback(comboName, currentIndex, i, models.length);
        }
        return result;
      }

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
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        // Same correction logic as the success path: this model served the
        // final response (even if it's a non-retryable error), so advance
        // rotation past it.
        if (isRotating && i > 0) {
          commitRotationAfterFallback(comboName, currentIndex, i, models.length);
        }
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // All models failed. Advance rotation past the last attempted model so the
  // next request doesn't restart on a known-failing model (it gives the next
  // entry a chance instead).
  if (isRotating) {
    commitRotationAfterFallback(comboName, currentIndex, rotatedModels.length - 1, models.length);
  }

  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
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
