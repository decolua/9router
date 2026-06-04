import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const CLAUDE_FORMAT_MODELS = new Set(["minimax-m2.5", "minimax-m2.7"]);

const BASE = "https://opencode.ai/zen/go/v1";

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(model) {
    this._lastModel = model;
    return CLAUDE_FORMAT_MODELS.has(model)
      ? `${BASE}/messages`
      : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (CLAUDE_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
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
