import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { parseApiKey, extractBearerToken } from "../utils/apiKey.js";
import { getMachineData } from "../services/storage.js";
import * as log from "../utils/logger.js";

/**
 * Handle GET /v1/models - OpenAI compatible models list
 * Returns models from all active providers and combos in OpenAI format
 * @param {Request} request
 * @param {Object} env
 * @param {string|null} machineIdOverride - machineId from URL (old format) or null (new format)
 */
export async function handleModels(request, env, machineIdOverride = null) {
  // Determine machineId: from URL (old) or from API key (new)
  let machineId = machineIdOverride;

  if (!machineId) {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return jsonResponse({ error: { message: "Missing API key", type: "auth_error" } }, 401);
    }

    const parsed = await parseApiKey(apiKey);
    if (!parsed) {
      return jsonResponse({ error: { message: "Invalid API key format", type: "auth_error" } }, 401);
    }

    if (!parsed.isNewFormat || !parsed.machineId) {
      return jsonResponse({ error: { message: "API key does not contain machineId", type: "auth_error" } }, 400);
    }

    machineId = parsed.machineId;
  }

  // Validate API key
  const apiKey = extractBearerToken(request);
  const data = await getMachineData(machineId, env);

  if (!data) {
    return jsonResponse({ error: { message: "Machine not found", type: "not_found" } }, 404);
  }

  const isValid = data.apiKeys?.some(k => k.key === apiKey) || false;
  if (!isValid) {
    return jsonResponse({ error: { message: "Invalid API key", type: "auth_error" } }, 401);
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const models = [];

    // Add combos first (they appear at the top)
    if (data.combos) {
      for (const combo of data.combos) {
        models.push({
          id: combo.name,
          object: "model",
          created: timestamp,
          owned_by: "combo",
          permission: [],
          root: combo.name,
          parent: null,
        });
      }
    }

    // Build set of active provider aliases from machine data
    const activeAliases = new Set();
    if (data.providers) {
      for (const [, conn] of Object.entries(data.providers)) {
        if (conn.isActive === false) continue;
        const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
        activeAliases.add(alias);
      }
    }

    // Add provider models
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      // Only include models from active providers
      if (activeAliases.size > 0 && !activeAliases.has(alias)) {
        continue;
      }

      for (const model of providerModels) {
        models.push({
          id: alias + "/" + model.id,
          object: "model",
          created: timestamp,
          owned_by: alias,
          permission: [],
          root: model.id,
          parent: null,
        });
      }
    }

    log.info("MODELS", machineId + " | " + models.length + " models");

    return jsonResponse({
      object: "list",
      data: models,
    });
  } catch (error) {
    log.error("MODELS", error.message);
    return jsonResponse(
      { error: { message: error.message, type: "server_error" } },
      500
    );
  }
}

/**
 * Handle GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 * @param {Request} request
 * @param {Object} env
 * @param {string|null} machineIdOverride
 */
export async function handleModelsGemini(request, env, machineIdOverride = null) {
  // Determine machineId: from URL (old) or from API key (new)
  let machineId = machineIdOverride;

  if (!machineId) {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return jsonResponse({ error: { message: "Missing API key" } }, 401);
    }

    const parsed = await parseApiKey(apiKey);
    if (!parsed || !parsed.isNewFormat || !parsed.machineId) {
      return jsonResponse({ error: { message: "Invalid API key" } }, 401);
    }

    machineId = parsed.machineId;
  }

  // Validate API key
  const apiKey = extractBearerToken(request);
  const data = await getMachineData(machineId, env);

  if (!data) {
    return jsonResponse({ error: { message: "Machine not found" } }, 404);
  }

  const isValid = data.apiKeys?.some(k => k.key === apiKey) || false;
  if (!isValid) {
    return jsonResponse({ error: { message: "Invalid API key" } }, 401);
  }

  try {
    const models = [];

    // Build set of active provider aliases
    const activeAliases = new Set();
    if (data.providers) {
      for (const [, conn] of Object.entries(data.providers)) {
        if (conn.isActive === false) continue;
        const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
        activeAliases.add(alias);
      }
    }

    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      if (activeAliases.size > 0 && !activeAliases.has(alias)) continue;

      for (const model of providerModels) {
        models.push({
          name: "models/" + alias + "/" + model.id,
          displayName: model.name || model.id,
          description: alias + " model: " + (model.name || model.id),
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    log.info("MODELS", machineId + " | " + models.length + " models (Gemini format)");

    return jsonResponse({ models });
  } catch (error) {
    log.error("MODELS", error.message);
    return jsonResponse({ error: { message: error.message } }, 500);
  }
}

/**
 * Helper to create JSON response with CORS
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
