import { DefaultExecutor } from "./default.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";

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
    return body;
  }

  async execute(options) {
    const result = await super.execute(options);
    if (result.response.status !== HTTP_STATUS.BAD_REQUEST || options.body?.max_tokens === undefined
      || options.signal?.aborted) return result;

    let error;
    try { error = (await result.response.clone().json())?.error; } catch { return result; }
    if (error?.code !== "unsupported_parameter" || error?.param !== "max_tokens") return result;
    if (options.signal?.aborted) return result;

    // Deployment names do not identify the underlying model. Negotiate only
    // after rejection, preserving legacy deployments that still need max_tokens.
    const body = { ...options.body };
    if (body.max_completion_tokens === undefined) body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    return super.execute({ ...options, body });
  }
}
