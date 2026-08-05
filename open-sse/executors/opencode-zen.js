import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_MODELS } from "../providers/index.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

const BASE = "https://opencode.ai/zen/v1";

function isClaudeFormat(model) {
  const entry = (PROVIDER_MODELS["opencode-zen"] || []).find((m) => m.id === model);
  return entry?.targetFormat === "claude";
}

export class OpenCodeZenExecutor extends BaseExecutor {
  constructor() {
    super("opencode-zen", PROVIDERS["opencode-zen"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(model) {
    this._lastModel = model;
    return isClaudeFormat(model)
      ? `${BASE}/messages`
      : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (isClaudeFormat(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}