import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const MODELS_TIMEOUT_MS = 20000;

function parseCompatibleModels(data) {
  const rawList = Array.isArray(data) ? data : (data?.data || data?.models || data?.results || []);
  return rawList.map((model) => {
    if (typeof model === "string") return { id: model, name: model };
    const id = model?.id || model?.name || model?.model;
    return { id, name: model?.display_name || model?.displayName || model?.name || id };
  }).filter((model) => Boolean(model.id));
}

export async function fetchCompatibleProviderModels(connection, providerNode) {
  const isOpenAI = isOpenAICompatibleProvider(connection?.provider);
  const isAnthropic = isAnthropicCompatibleProvider(connection?.provider);
  if (!isOpenAI && !isAnthropic) return { models: [] };

  let baseUrl = connection.providerSpecificData?.baseUrl || providerNode?.baseUrl;
  if (!baseUrl) {
    const label = isAnthropic ? "Anthropic" : "OpenAI";
    return { error: `No base URL configured for ${label} compatible provider`, status: 400 };
  }

  baseUrl = baseUrl.replace(/\/$/, "");
  if (isAnthropic && baseUrl.endsWith("/messages")) {
    baseUrl = baseUrl.slice(0, -9);
  }

  const url = `${baseUrl}/models`;
  const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "9router/0.5 (models-discovery)",
  };
  if (isAnthropic) {
    headers["anthropic-version"] = "2023-06-01";
    if (connection.apiKey) {
      headers["x-api-key"] = connection.apiKey;
      headers.Authorization = `Bearer ${connection.apiKey}`;
    }
  } else if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  }

  const response = await proxyAwareFetch(
    url,
    {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    },
    proxy
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.log(`Error fetching models from ${connection.provider}:`, errorText);
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }

  return { models: parseCompatibleModels(await response.json()) };
}
