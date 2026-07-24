import { DefaultExecutor } from "./default.js";

const GPT5_OR_REASONING_MODEL = /(?:^|[/_-])(?:gpt-5|o(?:1|3|4))(?:[._-]|$)/i;

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

  transformRequest(model, body, stream, credentials) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !GPT5_OR_REASONING_MODEL.test(String(model || ""))
    ) {
      return body;
    }

    const transformed = { ...body };

    if (transformed.max_completion_tokens === undefined && transformed.max_tokens !== undefined) {
      transformed.max_completion_tokens = transformed.max_tokens;
    }
    delete transformed.max_tokens;

    if (transformed.temperature !== undefined && transformed.temperature !== 1) {
      delete transformed.temperature;
    }

    const usesFunctionTools = transformed.tools?.some((tool) => tool?.type === "function");
    if (transformed.reasoning_effort === "none" || usesFunctionTools) {
      delete transformed.reasoning_effort;
    }

    return transformed;
  }
}
