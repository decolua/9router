import { getProviderConnections, validateApiKey } from "@/models";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/shared/constants/models";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

function buildModels(connections) {
  const models = [];
  const seenProviders = new Set();
  const seenModels = new Set();

  for (const connection of connections) {
    if (connection.provider === "openrouter") {
      continue;
    }

    if (seenProviders.has(connection.provider)) {
      continue;
    }

    seenProviders.add(connection.provider);

    const alias = PROVIDER_ID_TO_ALIAS[connection.provider] || connection.provider;
    const providerModels = PROVIDER_MODELS[alias] || [];

    for (const model of providerModels) {
      const key = `${connection.provider}:${model.id}`;
      if (seenModels.has(key)) {
        continue;
      }
      seenModels.add(key);
      models.push({
        name: `models/${connection.provider}/${model.id}`,
        displayName: model.name || model.id,
        description: `${connection.provider} model: ${model.name || model.id}`,
        supportedGenerationMethods: ["generateContent"],
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
  }

  return models;
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json({ error: "Missing API key" }, { status: 401 });
    }

    const apiKey = authHeader.slice(7);
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return Response.json({ error: "Invalid API key" }, { status: 401 });
    }

    const connections = await getProviderConnections({ isActive: true });
    const models = buildModels(connections);

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
