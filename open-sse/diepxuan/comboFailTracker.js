/**
 * Combo Model Fail Tracker - Skip models that fail frequently
 * 
 * Tracks consecutive failures per model within a combo.
 * When a model fails >= MAX_FAILS times consecutively, it gets skipped
 * until RESET_AFTER_MS elapses without a failure.
 */

const failState = new Map();  // key: "comboName:modelStr" → { count, lastAt }

const MAX_FAILS = 3;
const RESET_AFTER_MS = 5 * 60 * 1000;  // 5 minutes

/**
 * Check if a model should be skipped due to excessive failures
 * @param {string} modelStr - Model identifier
 * @param {string} comboName - Combo name
 * @returns {boolean} true if model should be skipped
 */
export function shouldSkipModelInCombo(modelStr, comboName) {
  const key = `${comboName}:${modelStr}`;
  const state = failState.get(key);
  if (!state) return false;

  // Reset if enough time has passed since last failure
  if (Date.now() - state.lastAt > RESET_AFTER_MS) {
    failState.delete(key);
    return false;
  }

  return state.count >= MAX_FAILS;
}

/**
 * Record the result of a combo model request
 * @param {string} modelStr - Model identifier
 * @param {string} comboName - Combo name
 * @param {boolean} success - Whether the request succeeded
 */
export function recordComboModelResult(modelStr, comboName, success) {
  const key = `${comboName}:${modelStr}`;

  if (success) {
    failState.delete(key);  // Reset on success
    return;
  }

  const cur = failState.get(key);
  failState.set(key, {
    count: (cur?.count || 0) + 1,
    lastAt: Date.now()
  });
}

/**
 * Reset fail tracking for a combo (or all combos if comboName is omitted)
 * @param {string} [comboName] - Combo name to reset, or omit to clear all
 */
export function resetComboFailTracker(comboName) {
  if (comboName) {
    for (const key of failState.keys()) {
      if (key.startsWith(`${comboName}:`)) failState.delete(key);
    }
  } else {
    failState.clear();
  }
}
