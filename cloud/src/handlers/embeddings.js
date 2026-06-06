import { getModelInfoCore } from "../../../open-sse/services/model.js";
import { handleEmbeddingsCore } from "../../../open-sse/handlers/embeddingsCore.js";
import { checkFallbackError } from "../../../open-sse/services/accountFallback.js";
import { parseApiKey, extractBearerToken } from "../utils/apiKey.js";
import { getMachineData, saveMachineData } from "../services/storage.js";

function jsonError(status, message, headers = {}) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers },
  });
}

function withCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "*");
  return response;
}

function isKeyAllowed(machineData, token) {
  return Array.isArray(machineData?.apiKeys) && machineData.apiKeys.some((key) => key?.key === token);
}

function availableProviders(machineData, provider, excludeIds) {
  return Object.entries(machineData?.providers || {})
    .map(([id, data]) => ({ id, ...data }))
    .filter((conn) => conn.provider === provider && conn.isActive !== false && !excludeIds.has(conn.id));
}

export async function handleEmbeddings(request, env, ctx, machineIdOverride = null) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const token = extractBearerToken(request);
  if (!token) return jsonError(401, "Missing API key");

  let machineId = machineIdOverride;
  if (!machineId) {
    const parsed = await parseApiKey(token);
    if (!parsed) return jsonError(401, "Invalid API key format");
    if (!parsed.machineId) return jsonError(400, "Use machineId endpoint for old-format API keys");
    machineId = parsed.machineId;
  }

  const machineData = await getMachineData(env, machineId);
  if (!isKeyAllowed(machineData, token)) return jsonError(401, "Invalid API key");

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (!body.model) return jsonError(400, "Missing model");
  if (body.input === undefined) return jsonError(400, "Missing required field: input");

  const modelInfo = await getModelInfoCore(body.model, machineData?.modelAliases || {});
  if (!modelInfo?.provider) return jsonError(400, "Invalid model format");

  const excludeIds = new Set();
  while (true) {
    const candidates = availableProviders(machineData, modelInfo.provider, excludeIds);
    if (candidates.length === 0) return jsonError(400, `No credentials for provider: ${modelInfo.provider}`);

    const credentials = candidates[0];
    if (credentials.status === "unavailable" && credentials.rateLimitedUntil) {
      const retryAfter = Math.max(1, Math.ceil((new Date(credentials.rateLimitedUntil).getTime() - Date.now()) / 1000));
      return jsonError(Number(credentials.errorCode) || 429, credentials.lastError || "Provider unavailable", { "Retry-After": String(retryAfter) });
    }

    const result = await handleEmbeddingsCore({ body, modelInfo, credentials });
    if (result.success) return withCors(result.response);

    if (checkFallbackError(result.status)) {
      credentials.status = "unavailable";
      credentials.lastError = result.error;
      credentials.errorCode = result.status;
      machineData.providers[credentials.id] = credentials;
      await saveMachineData(env, machineId, machineData);
      excludeIds.add(credentials.id);
      if (availableProviders(machineData, modelInfo.provider, excludeIds).length === 0) {
        return withCors(result.response || jsonError(result.status || 503, result.error || "Provider unavailable"));
      }
      continue;
    }

    return withCors(result.response || jsonError(result.status || 500, result.error || "Embeddings failed"));
  }
}
