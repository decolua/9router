// CodeBuddy CN model discovery + capability extraction.
//
// This service owns the upstream response contract while the provider registry
// owns transport endpoints and headers. The route only publishes the resulting
// model and capability projections.

import { PROVIDERS } from "../providers/index.js";

const PROVIDER_ID = "codebuddy-cn";

/**
 * Map one raw CodeBuddy model into a capability patch.
 * Exported so the route can pass it straight to publishDiscoveredCaps without
 * duplicating field names across providers.
 */
export function mapCodebuddyCnCaps(m) {
  const caps = {};
  if (typeof m.supportsImages === "boolean") caps.vision = m.supportsImages;
  if (typeof m.supportsToolCall === "boolean") caps.tools = m.supportsToolCall;
  if (typeof m.supportsReasoning === "boolean") caps.reasoning = m.supportsReasoning;
  if (m.maxInputTokens) caps.contextWindow = m.maxInputTokens;
  if (m.maxOutputTokens) caps.maxOutput = m.maxOutputTokens;
  return caps;
}

/**
 * Fetch the live model list + raw models (for cap publishing).
 * @returns {Promise<{models?: Array<{id,name}>, rawModels?: object[], error?: string, status?: number}>}
 */
export async function resolveCodebuddyCnModels(connection) {
  const token = connection.accessToken;
  if (!token) return { error: "No access token", status: 401 };

  const config = PROVIDERS[PROVIDER_ID]?.modelDiscovery;
  if (!config?.urlTemplate) return { error: "Model discovery not configured", status: 500 };

  const eid = connection.providerSpecificData?.enterpriseId || "personal";
  const url = config.urlTemplate.replace("{enterpriseId}", eid);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    return { error: `Fetch failed: ${e.message}`, status: 502 };
  }

  if (!response.ok) {
    return { error: `Upstream ${response.status}`, status: response.status };
  }

  const data = await response.json();
  const allModels = (data?.data?.models || []).filter(Boolean);

  // Client filters to models the "cli" agent is allowed to use; surface only
  // those — otherwise we'd show image-only models (hunyuan-image etc.).
  const cliAgent = (data?.data?.agents || []).find((a) => a.name === "cli");
  const cliIds = cliAgent?.models ?? [];
  const rawModels = cliIds.length ? allModels.filter((m) => cliIds.includes(m.id)) : allModels;

  const models = rawModels.filter((m) => m?.id).map((m) => ({ id: m.id, name: m.name || m.id }));
  return { models, rawModels };
}
