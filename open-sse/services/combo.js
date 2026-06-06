/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { requestHasTools, deriveNamespacedSessionKey } from "../utils/sessionFingerprint.js";

// Re-export so callers can keep the historical import path.
export { requestHasTools };

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

/**
 * Sticky-provider state for tool (coding-agent) sessions.
 *
 * Coding agents run long multi-turn sessions where each turn references
 * tool_use / tool_call_id values produced by a specific provider in earlier
 * turns. If a combo silently switches provider mid-session (e.g. on a transient
 * error), the new provider receives tool ids it never issued and may reject or
 * hallucinate. To keep continuity we remember which combo model last succeeded
 * for a session and try it first on subsequent turns, while still allowing the
 * normal ordered fallback if that model is now unavailable.
 *
 * Key = `${comboName}::${conversationFingerprint}`, Value = { model, lastUsed }.
 * @type {Map<string, { model: string, lastUsed: number }>}
 */
const comboStickyStore = new Map();

const STICKY_TTL_MS = 30 * 60 * 1000; // 30 min of inactivity
const STICKY_MAX_ENTRIES = 2000;

const stickyCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of comboStickyStore) {
    if (now - entry.lastUsed > STICKY_TTL_MS) comboStickyStore.delete(key);
  }
}, 5 * 60 * 1000);
if (stickyCleanup.unref) stickyCleanup.unref();

/**
 * Derive a stable session key for sticky combo routing. Returns null when
 * there is no usable anchor text (caller should skip sticky routing).
 * @param {Object} body
 * @param {string} [comboName]
 * @returns {string|null}
 */
export function deriveComboSessionKey(body, comboName) {
  return deriveNamespacedSessionKey(body, comboName);
}

function getStickyModel(sessionKey) {
  if (!sessionKey) return null;
  const entry = comboStickyStore.get(sessionKey);
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry.model;
}

function setStickyModel(sessionKey, model) {
  if (!sessionKey || !model) return;
  if (!comboStickyStore.has(sessionKey) && comboStickyStore.size >= STICKY_MAX_ENTRIES) {
    const oldest = comboStickyStore.keys().next().value;
    if (oldest !== undefined) comboStickyStore.delete(oldest);
  }
  comboStickyStore.set(sessionKey, { model, lastUsed: Date.now() });
}

/**
 * Reorder models so the sticky model (if any and still part of the combo) is
 * tried first, preserving the original relative order for the remainder.
 * @param {string[]} models
 * @param {string|null} stickyModel
 * @returns {string[]}
 */
function applyStickyOrder(models, stickyModel) {
  if (!stickyModel || !models.includes(stickyModel) || models[0] === stickyModel) {
    return models;
  }
  return [stickyModel, ...models.filter(m => m !== stickyModel)];
}

/**
 * Reset sticky session routing state (testing / explicit reset).
 * @param {string} [sessionKey] - Specific key to clear; omit to clear all.
 */
export function resetComboStickySessions(sessionKey) {
  if (sessionKey) comboStickyStore.delete(sessionKey);
  else comboStickyStore.clear();
}

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
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

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
  // Coding agents send tools and need stable priority order. Keep the original
  // combo strategy for normal chat, but try tool-capable requests top-to-bottom
  // while preserving the exact same body (messages/tools/tool_choice/context).
  const hasTools = requestHasTools(body);

  // Sticky-provider continuity: within a tool session, prefer the model that
  // last succeeded so tool_use/tool_call_id references stay with one provider
  // across turns. Falls back through the remaining models if it is unavailable.
  const sessionKey = hasTools ? deriveComboSessionKey(body, comboName) : null;
  const stickyModel = sessionKey ? getStickyModel(sessionKey) : null;

  const orderedModels = hasTools
    ? applyStickyOrder(models, stickyModel)
    : getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  const rotatedModels = orderedModels;

  if (hasTools) {
    const stickyNote = stickyModel ? `, sticky=${stickyModel}` : "";
    log.info("COMBO", `Tool request: ordered fallback ${comboName || ""} (${rotatedModels.length} models), tools/context preserved${stickyNote}`);
  }
  
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
        // Remember the winning model so the next turn of this tool session
        // sticks with the same provider for tool-call continuity.
        if (sessionKey) setStickyModel(sessionKey, modelStr);
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

  // All models failed
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
