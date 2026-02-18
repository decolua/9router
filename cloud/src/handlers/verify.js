import { parseApiKey, extractBearerToken } from "../utils/apiKey.js";
import { getMachineData } from "../services/storage.js";

/**
 * Verify API key endpoint
 * @param {Request} request
 * @param {Object} env
 * @param {string|null} machineIdOverride - machineId from URL (old format) or null (new format)
 */
export async function handleVerify(request, env, machineIdOverride = null) {
  const apiKey = extractBearerToken(request);
  if (!apiKey) {
    return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
  }

  // Determine machineId: from URL (old) or from API key (new)
  let machineId = machineIdOverride;
  
  if (!machineId) {
    const parsed = await parseApiKey(apiKey);
    if (!parsed) {
      return jsonResponse({ error: "Invalid API key format" }, 401);
    }
    
    if (!parsed.isNewFormat || !parsed.machineId) {
      return jsonResponse({ error: "API key does not contain machineId" }, 400);
    }
    
    machineId = parsed.machineId;
  }

  const data = await getMachineData(machineId, env);
  
  if (!data) {
    return jsonResponse({ error: "Machine not found" }, 404);
  }

  const isValid = data.apiKeys?.some(k => k.key === apiKey) || false;
  
  if (!isValid) {
    return jsonResponse({ error: "Invalid API key" }, 401);
  }

  return jsonResponse({ 
    valid: true,
    machineId,
    providersCount: Object.keys(data.providers || {}).length
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

