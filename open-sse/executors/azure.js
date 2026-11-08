import { DefaultExecutor } from "./default.js";
import { HTTP_STATUS, AZURE_TOKEN_LIMIT_CACHE_MAX_ENTRIES } from "../config/runtimeConfig.js";

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
    this.completionTokenDeployments = new Set();
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const azureEndpoint = credentials?.providerSpecificData?.azureEndpoint
      || process.env.AZURE_ENDPOINT
      || "https://api.openai.com";

    const apiVersion = credentials?.providerSpecificData?.apiVersion
      || process.env.AZURE_API_VERSION
      || "2024-10-01-preview";

    const deployment = credentials?.providerSpecificData?.deployment
      || model
      || process.env.AZURE_DEPLOYMENT
      || "gpt-4";

    const endpoint = azureEndpoint.replace(/\/$/, "");
    return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
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
    return body;
  }

  async execute(options) {
    // The URL scopes preferences to endpoint, deployment and API version, never
    // to a model-name heuristic. Only successful compatibility retries teach us.
    const deploymentUrl = this.buildUrl(options.model, options.stream, 0, options.credentials);
    const useCompletionTokens = options.body?.max_tokens !== undefined
      && this.completionTokenDeployments.has(deploymentUrl);
    let body = options.body;
    if (useCompletionTokens) {
      body = { ...body };
      if (body.max_completion_tokens === undefined) body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    const result = await super.execute({ ...options, body });
    if (result.response.status !== HTTP_STATUS.BAD_REQUEST || options.body?.max_tokens === undefined
      || options.signal?.aborted) return result;

    let error;
    try { error = (await result.response.clone().json())?.error; } catch { return result; }
    const rejectedParameter = useCompletionTokens ? "max_completion_tokens" : "max_tokens";
    if (error?.code !== "unsupported_parameter" || error?.param !== rejectedParameter) return result;
    if (options.signal?.aborted) return result;

    if (useCompletionTokens) {
      // Deployments can be repointed to legacy models. Forget the stale hint,
      // but never override an explicitly supplied completion-token parameter.
      this.completionTokenDeployments.delete(deploymentUrl);
      if (options.body.max_completion_tokens !== undefined) return result;
      return super.execute(options);
    }

    body = { ...options.body };
    if (body.max_completion_tokens === undefined) body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    const retry = await super.execute({ ...options, body });
    if (retry.response.ok) {
      if (this.completionTokenDeployments.size >= AZURE_TOKEN_LIMIT_CACHE_MAX_ENTRIES) {
        this.completionTokenDeployments.delete(this.completionTokenDeployments.values().next().value);
      }
      this.completionTokenDeployments.add(deploymentUrl);
    }
    return retry;
  }
}
