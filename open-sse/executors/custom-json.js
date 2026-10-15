import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { CUSTOM_JSON_RETRY_CONFIG } from "../config/customJson.js";
import { normalizeCustomJsonConfig, buildCustomJsonRequest, buildCustomJsonHeaders, extractCustomJsonText } from "../utils/customJson.js";

// Business endpoints return JSON. Buffer one response, then present it in the
// OpenAI format consumed by the existing downstream protocol translators.
export class CustomJsonExecutor extends BaseExecutor {
  constructor(provider) {
    // A business request may have side effects: never automatically replay it.
    super(provider, { retry: CUSTOM_JSON_RETRY_CONFIG });
  }

  getBaseUrls() { return []; }
  buildMethod(credentials) { return credentials.providerSpecificData.customJson.method; }
  buildUrl(model, stream, urlIndex, credentials) { return credentials.providerSpecificData.baseUrl; }
  transformRequest(model, body, stream, credentials) {
    const config = normalizeCustomJsonConfig(credentials.providerSpecificData.customJson, credentials.providerSpecificData.baseUrl);
    return buildCustomJsonRequest(config, model, body);
  }
  buildHeaders(credentials) {
    return buildCustomJsonHeaders(credentials.providerSpecificData.customJson, credentials.apiKey);
  }

  async execute(args) {
    const config = normalizeCustomJsonConfig(args.credentials.providerSpecificData.customJson, args.credentials.providerSpecificData.baseUrl);
    const signal = AbortSignal.any([AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS), ...(args.signal ? [args.signal] : [])]);
    const credentials = { ...args.credentials, providerSpecificData: { ...args.credentials.providerSpecificData, customJson: config } };
    // BaseExecutor supplies proxy handling, cancellation and target-request logging.
    const result = await super.execute({ ...args, credentials, signal, stream: false });
    // Returned headers are used for request logs; the real key has already been
    // sent by BaseExecutor and must not be persisted under a user-chosen name.
    if (config.authType !== "none") {
      const authName = config.authType === "bearer" ? "authorization" : config.authHeader.toLowerCase();
      result.headers = Object.fromEntries(Object.entries(result.headers).map(([name, value]) => [name, name.toLowerCase() === authName ? "[REDACTED]" : value]));
    }
    if (!result.response.ok) return result;
    let data, text;
    try {
      data = await result.response.json();
      text = extractCustomJsonText(config, data);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      return { ...result, response: Response.json({ error: { message: `Custom JSON response: ${error.message}` } }, { status: 502 }) };
    }
    const common = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model: args.model };
    const response = args.stream ? new Response([
      { ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
      { ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }) : Response.json({
      ...common, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    });
    return { ...result, response, responseFormat: "openai" };
  }
}
