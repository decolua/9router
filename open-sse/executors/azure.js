import { DefaultExecutor } from "./default.js";

const GPT5_OR_REASONING_MODEL =
  /(?:^|[/_-])(?:gpt-5|o(?:1|3|4))(?:[._-]|$)/i;

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
  }

  resolveDeployment(model, credentials = null) {
    return (
      credentials?.providerSpecificData?.deployment ||
      model ||
      process.env.AZURE_DEPLOYMENT ||
      "gpt-4"
    );
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const azureEndpoint =
      credentials?.providerSpecificData?.azureEndpoint ||
      process.env.AZURE_ENDPOINT ||
      "https://api.openai.com";

    const apiVersion =
      credentials?.providerSpecificData?.apiVersion ||
      process.env.AZURE_API_VERSION ||
      "2024-10-01-preview";

    const deployment = this.resolveDeployment(model, credentials);
    const endpoint = azureEndpoint.replace(/\/+$/, "");

    return (
      `${endpoint}/openai/deployments/` +
      `${encodeURIComponent(deployment)}/chat/completions` +
      `?api-version=${encodeURIComponent(apiVersion)}`
    );
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    const apiKey =
      credentials?.apiKey ||
      credentials?.accessToken ||
      process.env.OPENAI_API_KEY;

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    const organization =
      credentials?.providerSpecificData?.organization ||
      process.env.AZURE_ORGANIZATION;

    if (organization) {
      headers["OpenAI-Organization"] = organization;
    }

    if (stream) {
      headers.Accept = "text/event-stream";
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return body;
    }

    const deployment = this.resolveDeployment(model, credentials);

    if (!GPT5_OR_REASONING_MODEL.test(String(deployment))) {
      return body;
    }

    const transformed = { ...body };

    // GPT-5.x uses max_completion_tokens instead of max_tokens.
    if (
      transformed.max_completion_tokens === undefined &&
      transformed.max_tokens !== undefined
    ) {
      transformed.max_completion_tokens = transformed.max_tokens;
    }

    delete transformed.max_tokens;

    // GPT-5.x only accepts the default temperature value.
    if (
      transformed.temperature !== undefined &&
      transformed.temperature !== 1
    ) {
      delete transformed.temperature;
    }

    /*
     * This Azure GPT-5 deployment rejects reasoning_effort entirely through
     * /chat/completions. "none" is a no-op signal the backend rejects, so drop
     * it regardless of tools; with function tools the field is forbidden even
     * for real values, so strip it there too.
     */
    if (transformed.reasoning_effort === "none" || (Array.isArray(transformed.tools) && transformed.tools.length > 0)) {
      delete transformed.reasoning_effort;
    }

    return transformed;
  }
}
