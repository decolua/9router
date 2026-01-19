import { getProviderConnections, validateApiKey } from "@/models";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/shared/constants/models";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
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
        id: model.id,
        object: "model",
        owned_by: connection.provider,
      });
    }
  }

  return models;
}

/**
 * GET /v1 - Return models list (OpenAI compatible)
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing API key" }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const apiKey = authHeader.slice(7);
    const isValid = await validateApiKey(apiKey);

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid API key" }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const connections = await getProviderConnections({ isActive: true });
    const models = buildModels(connections);

    return new Response(
      JSON.stringify({
        object: "list",
        data: models
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  } catch (error) {
    console.log("Error fetching models:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch models" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
}
