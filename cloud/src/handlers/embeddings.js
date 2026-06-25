import { getModelInfoCore } from "../../../open-sse/services/model.js";
import { handleEmbeddingsCore } from "../../../open-sse/handlers/embeddingsCore.js";
import { parseApiKey } from "../utils/apiKey.js";
import { getMachineData, saveMachineData } from "../services/storage.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonError(status, message, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

function addCorsHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function selectCredentials(machineData, provider) {
  const providers = machineData?.providers || {};
  const now = Date.now();
  const entries = Object.entries(providers)
    .filter(([, account]) => account?.provider === provider && account?.isActive !== false)
    .sort((a, b) => (a[1].priority || 999) - (b[1].priority || 999));

  if (!entries.length) return { error: "No credentials for provider" };

  const available = entries.find(([, account]) => {
    if (!account.rateLimitedUntil) return true;
    return new Date(account.rateLimitedUntil).getTime() <= now;
  });

  if (available) {
    const [connectionId, account] = available;
    return {
      credentials: {
        ...account,
        connectionId,
      },
    };
  }

  const retryAt = Math.min(...entries.map(([, account]) => new Date(account.rateLimitedUntil).getTime()).filter(Number.isFinite));
  const retryAfter = Math.max(1, Math.ceil((retryAt - now) / 1000));
  return { rateLimited: true, retryAfter };
}

export async function handleEmbeddings(request, env, ctx, machineIdOverride = null) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const token = bearerToken(request);
  if (!token) return jsonError(401, "Missing API key");

  let machineId = machineIdOverride;
  if (!machineId) {
    const parsed = await parseApiKey(token, env);
    if (!parsed) return jsonError(401, "Invalid API key format");
    if (!parsed.machineId || parsed.isNewFormat === false) {
      return jsonError(400, "Use the machineId endpoint for this API key");
    }
    machineId = parsed.machineId;
  }

  const machineData = await getMachineData(env, machineId);
  const validKey = machineData?.apiKeys?.some((entry) => entry?.key === token);
  if (!validKey) return jsonError(401, "Invalid API key");

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (!body?.model) return jsonError(400, "Missing model");
  if (body.input === undefined || body.input === null) return jsonError(400, "Missing required field: input");

  const modelInfo = await getModelInfoCore(body.model, machineData?.modelAliases);
  if (!modelInfo?.provider || !modelInfo?.model) {
    return jsonError(400, "Invalid model format");
  }

  const selected = selectCredentials(machineData, modelInfo.provider);
  if (selected.error) return jsonError(400, selected.error);
  if (selected.rateLimited) {
    return jsonError(429, "All provider accounts are rate limited", {
      "Retry-After": String(selected.retryAfter),
    });
  }

  const result = await handleEmbeddingsCore({
    body,
    modelInfo,
    credentials: selected.credentials,
    onRequestSuccess: async () => {},
  });

  if (result.success) return addCorsHeaders(result.response);

  if (result.status === 429) {
    selected.credentials.rateLimitedUntil = new Date(Date.now() + 60000).toISOString();
    await saveMachineData(env, machineId, machineData);
  }

  return addCorsHeaders(result.response || jsonError(result.status || 500, result.error || "Embedding request failed"));
}
