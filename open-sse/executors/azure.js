import { DefaultExecutor } from "./default.js";
import { resolveOpenAICompatibleApiType } from "../services/provider.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";

// The v1 surface accepts only api-version=preview; a dated version
// (2024-10-01-preview, 2025-04-01-preview) answers 400 "API version not supported".
const RESPONSES_API_VERSION = "preview";
const TRANSIENT_RESPONSES_PROBE_STATUSES = new Set([
  HTTP_STATUS.REQUEST_TIMEOUT,
  HTTP_STATUS.RATE_LIMITED,
  HTTP_STATUS.SERVER_ERROR,
  HTTP_STATUS.BAD_GATEWAY,
  HTTP_STATUS.SERVICE_UNAVAILABLE,
  HTTP_STATUS.GATEWAY_TIMEOUT,
]);

/**
 * Resolve the upstream target for an azure connection. Single source for the URL
 * rules, shared by the executor and the connection validate/test probes so a
 * green "Test" can never mean a different endpoint than the router will call.
 *
 * Chat Completions puts the deployment in the path; the v1 Responses API is
 * resource-level and takes the deployment as `model` in the body instead. The
 * per-deployment path rejects function tools combined with reasoning_effort on
 * reasoning models (gpt-6-luna and friends), which is what Codex always sends.
 *
 * @param {object} psd - connection providerSpecificData
 * @param {string|null} model - requested model, used when no deployment is pinned
 * @returns {{ url: string, deployment: string, responses: boolean }}
 */
export function resolveAzureTarget(psd = {}, model = null) {
  const endpoint = (psd?.azureEndpoint || process.env.AZURE_ENDPOINT || "https://api.openai.com")
    .replace(/\/$/, "");
  const deployment = psd?.deployment || model || process.env.AZURE_DEPLOYMENT || "gpt-4";
  const responses = resolveOpenAICompatibleApiType("azure", { providerSpecificData: psd }) === "responses";

  if (responses) {
    return { url: `${endpoint}/openai/v1/responses?api-version=${RESPONSES_API_VERSION}`, deployment, responses };
  }

  const apiVersion = psd?.apiVersion || process.env.AZURE_API_VERSION || "2024-10-01-preview";
  return {
    url: `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    deployment,
    responses,
  };
}

/**
 * Did an azure credential probe reach a usable endpoint? Shared by the validate route and the
 * connection Test button so the two can't drift apart on the rule.
 *
 * The chat probe sends max_tokens:1, and a perfectly healthy deployment answers that with 400
 * ("max_tokens or model output limit was reached"), so that branch can only judge auth. The
 * Responses probe genuinely returns 200 when the surface exists, so it can be stricter: a
 * resource without the v1 surface answers 400 ("API version not supported") and an unknown
 * deployment answers 404 ("DeploymentNotFound"). Only successful responses and known
 * transient failures pass; an unknown client or server error does not establish a usable route.
 */
export function isAzureProbeValid(status, responses) {
  if (responses) return (status >= 200 && status < 300) || TRANSIENT_RESPONSES_PROBE_STATUSES.has(status);
  return status !== 401 && status !== 403;
}

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return resolveAzureTarget(credentials?.providerSpecificData, model).url;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    const apiKey = credentials?.apiKey
      || credentials?.accessToken
      || process.env.OPENAI_API_KEY;

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    const organization = credentials?.providerSpecificData?.organization
      || process.env.AZURE_ORGANIZATION;

    if (organization) {
      headers["OpenAI-Organization"] = organization;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const target = resolveAzureTarget(credentials?.providerSpecificData, model);
    // On the v1 path the deployment name moves from the URL into the body, so the
    // same connection resolves to the same deployment whichever apiType it is set to.
    return target.responses ? { ...body, model: target.deployment } : body;
  }
}
