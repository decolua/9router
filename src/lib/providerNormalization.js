import { AI_PROVIDERS } from "../shared/constants/providers.js";
import { validateQoderVpcDomain } from "open-sse/shared/qoder/sites.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if (AI_PROVIDERS[trimmed]) return trimmed;

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (AI_PROVIDERS[slug]) return slug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return providerByName?.id || trimmed;
}

export function normalizeProviderSpecificData(provider, body = {}, providerSpecificData = null) {
  const next = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  if (provider === "ollama-local") {
    const baseUrl = (
      next.baseUrl ||
      body.baseUrl ||
      body.baseURL ||
      body.ollamaHostUrl ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  // Qoder CN enterprise: normalize the access domain to a bare host within the
  // VPC namespace (accepts an https:// address like the sign-in prompt). An
  // invalid value is left for the route's namespace guard to reject.
  if ((provider === "qoder" || provider === "qoder-cn") && typeof next.enterpriseHost === "string" && next.enterpriseHost.trim()) {
    const host = validateQoderVpcDomain(next.enterpriseHost);
    if (host) next.enterpriseHost = host;
  }

  return Object.keys(next).length > 0 ? next : null;
}
