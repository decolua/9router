/**
 * Shared combo (model combo) handling with fallback support
 */

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
  const combos = Array.isArray(combosData) ? combosData : combosData?.combos || [];

  const combo = combos.find((c) => c.name === modelStr);
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
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log }) {
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const modelStr = models[i];
    log.info("COMBO", `Trying model ${i + 1}/${models.length}: ${modelStr}`);

    const result = await handleSingleModel(body, modelStr);

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
  return new Response(JSON.stringify({ error: lastError || "All combo models unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}
