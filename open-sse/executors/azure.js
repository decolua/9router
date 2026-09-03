import { DefaultExecutor } from "./default.js";

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
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

  // Azure OpenAI reasoning-model deployments (gpt-5*, o1-/o3-/o4- series) reject
  // the legacy `max_tokens` param with a 400 "Unsupported parameter" error and
  // require `max_completion_tokens` instead. Same rule the "github" executor
  // already applies for Copilot-hosted reasoning models.
  requiresMaxCompletionTokens(model) {
    return /gpt-5|o[134]-/i.test(model);
  }

  transformRequest(model, body, stream, credentials) {
    if (!this.requiresMaxCompletionTokens(model) || !body || typeof body !== "object" || body.max_tokens === undefined) {
      return body;
    }

    const transformed = { ...body };
    // An explicit max_completion_tokens from the caller wins; max_tokens is
    // only used as a fallback. Either way max_tokens must be stripped, or
    // Azure 400s on it regardless of max_completion_tokens being present.
    if (transformed.max_completion_tokens === undefined) {
      transformed.max_completion_tokens = transformed.max_tokens;
    }
    delete transformed.max_tokens;
    return transformed;
  }
}
