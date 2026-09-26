/**
 * Shared combo (model combo) handling with fallback support
 */

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @param {{ activeProviders?: Set<string>, activeModels?: Set<string> } | null} [filter]
 *   Optional filter — when provided, models whose provider is not in
 *   activeProviders or whose "provider/model" id is not in activeModels are
 *   dropped so the combo stays in sync with live provider connections.
 *   A combo that becomes empty after filtering returns null.
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData, filter = null) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;

  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);

  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    const models = combo.models;
    if (!filter || (!filter.activeProviders && !filter.activeModels)) {
      return models;
    }
    const activeProviders = filter.activeProviders;
    const activeModels = filter.activeModels;
    const filtered = models.filter((m) => {
      if (typeof m !== "string" || !m.includes("/")) return true;
      if (activeProviders) {
        const provider = m.split("/")[0];
        if (!activeProviders.has(provider)) return false;
      }
      if (activeModels && !activeModels.has(m)) return false;
      return true;
    });
    return filtered.length > 0 ? filtered : null;
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

  for (let i = 0; i < models.length; i++) {
    const modelStr = models[i];
    log.info("COMBO", `Trying model ${i + 1}/${models.length}: ${modelStr}`);

    let result;
    try {
      result = await handleSingleModel(body, modelStr);
    } catch (e) {
      lastError = `${modelStr}: ${e.message}`;
      log.warn("COMBO", `Model threw exception, trying next`, { model: modelStr, error: e.message });
      continue;
    }

    // Success or client error - return response
    if (result.ok || result.status < 500) {
      return result;
    }

    // 5xx error - try next model
    lastError = `${modelStr}: ${result.statusText || result.status}`;
    log.warn("COMBO", `Model failed, trying next`, { model: modelStr, status: result.status });
  }

  log.warn("COMBO", "All models failed");
  
  // Return 503 with last error
  return new Response(
    JSON.stringify({ error: lastError || "All combo models unavailable" }),
    { 
      status: 503, 
      headers: { "Content-Type": "application/json" }
    }
  );
}

