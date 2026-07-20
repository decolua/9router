import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  AUTOCLAW_CHAT_COMPLETIONS_URL,
  buildAutoClawProxyHeaders,
  resolveAutoClawUpstreamModel,
} from "../shared/autoclaw.js";
import { refreshAutoClawToken } from "../services/tokenRefresh/providers.js";

export class AutoClawExecutor extends BaseExecutor {
  constructor() {
    super("autoclaw", PROVIDERS.autoclaw || {
      baseUrl: AUTOCLAW_CHAT_COMPLETIONS_URL,
      format: "openai",
      forceStream: true,
    });
  }

  buildUrl() {
    return this.config?.baseUrl || AUTOCLAW_CHAT_COMPLETIONS_URL;
  }

  buildHeaders(credentials = {}, stream = true, overrides = {}) {
    const headers = buildAutoClawProxyHeaders({
      accessToken: credentials.accessToken || credentials.apiKey,
      model: overrides.model,
      timestamp: overrides.timestamp,
      requestId: overrides.requestId,
      traceId: overrides.traceId,
      stream: true,
    });
    if (!overrides.model) delete headers["X-Request-Model"];
    return headers;
  }

  transformRequest(model, body) {
    return {
      ...body,
      stream: true,
    };
  }

  prepareRequestBody(transformedBody, headers) {
    if (!headers["X-Request-Model"]) {
      headers["X-Request-Model"] = resolveAutoClawUpstreamModel(transformedBody?.model);
    }
    return JSON.stringify(transformedBody);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshAutoClawToken(
      credentials?.refreshToken,
      credentials?.providerSpecificData || {},
      log,
      proxyOptions,
    );
  }
}

export const __test__ = {
  resolveAutoClawUpstreamModel,
};
