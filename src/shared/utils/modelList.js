import { getProviderConnections, validateApiKey } from "@/models";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/shared/constants/models";

const MODEL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

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
      const key = `${alias}:${model.id}`;
      if (seenModels.has(key)) {
        continue;
      }
      seenModels.add(key);
      models.push({
        id: model.id,
        name: model.name || model.id,
        provider: connection.provider,
        providerAlias: alias,
      });
    }
  }

  return models;
}

export async function getAuthorizedModelList(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    const error = new Error("Missing API key");
    error.status = 401;
    throw error;
  }

  const apiKey = authHeader.slice(7);
  const isValid = await validateApiKey(apiKey);

  if (!isValid) {
    const error = new Error("Invalid API key");
    error.status = 401;
    throw error;
  }

  const connections = await getProviderConnections({ isActive: true });
  return buildModels(connections);
}

export function getModelCorsHeaders() {
  return MODEL_CORS_HEADERS;
}
