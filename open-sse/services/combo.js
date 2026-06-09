/**
 * Shared combo (model combo) handling with fallback support
 * Auto-filters vision-capable models when request contains images.
 * Smart Combo: tracks model health, auto-skips failed/rate-limited models.
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

// ─── RU Mode: region-locked provider filter ─────────────────────────────────

/**
 * Provider prefixes known to be blocked in Russia (region-locked).
 * When ruBypassEnabled is true, these are auto-skipped in combos.
 */
const RU_BLOCKED_PROVIDERS = new Set([
  "gemini/", "gc/", "ag/", "gh/",
]);

/**
 * Check if a model uses a region-blocked provider.
 */
function isRuBlocked(modelStr) {
  for (const prefix of RU_BLOCKED_PROVIDERS) {
    if (modelStr.startsWith(prefix)) return true;
  }
  return false;
}

// ─── Model Health Tracking ──────────────────────────────────────────────────

/**
 * In-memory health state per combo model.
 * @type {Map<string, { fails: number, lastError: string|null, until: number }>}
 */
const modelHealth = new Map();
const HEALTH_TTL_BASE_MS = 30 * 1000; // 30s initial cooldown
const HEALTH_TTL_MAX_MS = 10 * 60 * 1000; // 10 min max cooldown

function healthKey(comboName, modelStr) { return `${comboName}::${modelStr}`; }

/** Mark model failed — exponential backoff. */
function markModelFailed(comboName, modelStr, errorText) {
  const key = healthKey(comboName, modelStr);
  const prev = modelHealth.get(key);
  const fails = (prev?.fails || 0) + 1;
  const cooldown = Math.min(HEALTH_TTL_BASE_MS * Math.pow(2, fails - 1), HEALTH_TTL_MAX_MS);
  modelHealth.set(key, { fails, lastError: errorText || "error", until: Date.now() + cooldown });
}

/** Mark model success — reset health. */
function markModelSuccess(comboName, modelStr) {
  const key = healthKey(comboName, modelStr);
  modelHealth.delete(key);
}

/** Check if model is in cooldown. */
function isModelUnhealthy(comboName, modelStr) {
  const h = modelHealth.get(healthKey(comboName, modelStr));
  if (!h) return false;
  if (Date.now() >= h.until) { modelHealth.delete(healthKey(comboName, modelStr)); return false; }
  return true;
}

/** Sort models: healthy first, cooldown last. */
function prioritizeModels(models, comboName) {
  return [...models].sort((a, b) => {
    const aBad = isModelUnhealthy(comboName, a);
    const bBad = isModelUnhealthy(comboName, b);
    if (aBad && !bBad) return 1;
    if (!aBad && bBad) return -1;
    return 0;
  });
}

// ─── Vision Detection ───────────────────────────────────────────────────────

/**
 * Set of model prefixes that support vision (image-to-text).
 * Used by combo to auto-filter non-vision models when request has images.
 */
const VISION_MODEL_PREFIXES = new Set([
  "gemini/",
  "gc/",
  "gh/gpt-4o",
  "gh/gpt-4.1",
  "gh/gpt-5",
  "openrouter/",
  "ag/",
  "xai/grok",
  "anthropic/claude",
  "openai/gpt",
  "mistral/",
  "groq/llama",
  "oc/",
]);

/**
 * Check if a model string supports vision based on known prefixes.
 */
function isVisionModel(modelStr) {
  for (const prefix of VISION_MODEL_PREFIXES) {
    if (modelStr.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Check if request body contains image content (vision request).
 * Supports OpenAI messages[] and Anthropic input[] formats.
 */
function hasImageContent(body) {
  const messages = body?.messages || body?.input || [];

  for (const msg of messages) {
    const content = msg?.content;
    if (!content) continue;

    // Array format: [{ type: "image_url" | "image", ... }]
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "image_url" || part?.type === "image" || part?.type === "image_base64") {
          return true;
        }
      }
    }
  }

  // Anthropic Messages API uses source.type === "image" inside content blocks
  for (const msg of messages) {
    const content = msg?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.source?.type === "image" || part?.source?.type === "image_base64") {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Filter combo models to only those supporting vision when request has images.
 */
function filterModelsForRequest(models, body) {
  if (!models || models.length === 0) return models;
  if (!hasImageContent(body)) return models;

  const filtered = models.filter((m) => isVisionModel(m));
  if (filtered.length === 0) {
    // Fallback: if no vision models found in combo, return all (let it fail naturally)
    return models;
  }
  return filtered;
}

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
    // Normalize: combo models can be strings or objects {provider, connectionId, model, priority}
    return combo.models.map(m => {
      if (typeof m === 'string') return m;
      if (typeof m === 'object' && m.model) {
        if (m.provider) return `${m.provider}/${m.model}`;
        return m.model;
      }
      return String(m);
    });
  }
  return null;
}

/**
 * Handle combo chat with fallback
 * Auto-filters vision models when request contains images.
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
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, ruBypassEnabled = false }) {
  // Auto-filter: if request has images, use only vision-capable models
  let effectiveModels = filterModelsForRequest(models, body);
  const hasVision = hasImageContent(body);
  if (hasVision) {
    const skipped = models.length - effectiveModels.length;
    if (skipped > 0) {
      log.info("COMBO", `Vision request detected, skipped ${skipped} non-vision models`);
    }
  }

  // RU Mode: skip region-blocked providers (gemini, antigravity, github)
  // Activated via settings.ruBypassEnabled (persistent toggle in Dashboard)
  if (ruBypassEnabled) {
    const before = effectiveModels.length;
    effectiveModels = effectiveModels.filter(m => !isRuBlocked(m));
    const skipped = before - effectiveModels.length;
    if (skipped > 0) {
      log.info("COMBO", `RU Mode: skipped ${skipped} region-blocked model(s)`);
    }
  }

  // Smart Combo: skip unhealthy models, prioritize healthy ones
  const healthyModels = effectiveModels.filter(m => !isModelUnhealthy(comboName, m));
  const sickCount = effectiveModels.length - healthyModels.length;
  if (sickCount > 0) {
    log.info("COMBO", `Smart Combo: ${sickCount} model(s) in cooldown, skipping`);
  }
  const prioritizedModels = prioritizeModels(healthyModels.length > 0 ? healthyModels : effectiveModels, comboName);

  // Apply rotation strategy if enabled
  const rotatedModels = getRotatedModels(prioritizedModels, comboName, comboStrategy, comboStickyLimit);
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      
      // Success (2xx) - return response + reset health
      if (result.ok) {
        markModelSuccess(comboName, modelStr);
        log.info("COMBO", `Model ${modelStr} succeeded`);
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

      // Fallback to next model — Smart Combo: mark model unhealthy
      markModelFailed(comboName, modelStr, errorText);
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed (cooldown ${HEALTH_TTL_BASE_MS/1000}s-${HEALTH_TTL_MAX_MS/60000}min), trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      markModelFailed(comboName, modelStr, error.message);
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error (cooldown), trying next`, { error: lastError });
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
