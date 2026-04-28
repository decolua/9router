import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const CLAUDE_FORMAT_MODELS = new Set(["minimax-m2.5", "minimax-m2.7"]);

const BASE = "https://opencode.ai/zen/go/v1";

// Kimi (Moonshot) requires reasoning_content on assistant tool_call messages when thinking is on.
// OpenAI-format clients don't send it -> upstream 400. Inject a non-empty placeholder.
const KIMI_REASONING_PLACEHOLDER = " ";

// DeepSeek models with thinking mode require reasoning_content from prior assistant messages
// to be passed back. This set contains DeepSeek models that require this handling.
const DEEPSEEK_THINKING_MODELS = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-r1",
  "deepseek-r1-distill-llama-70b",
  "deepseek-r1-distill-qwen-32b",
  "deepseek-r1-distill-qwen-7b",
]);

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
    if (!body?.messages) return body;

    // Handle Kimi (Moonshot) - requires reasoning_content on assistant tool_call messages
    if (model?.startsWith?.("kimi-")) {
      const messages = body.messages.map(m => {
        if (m?.role === "assistant" && Array.isArray(m.tool_calls) && !("reasoning_content" in m)) {
          return { ...m, reasoning_content: KIMI_REASONING_PLACEHOLDER };
        }
        return m;
      });
      return { ...body, messages };
    }

    // Handle DeepSeek thinking models - add reasoning_content placeholder to assistant messages
    // DeepSeek API requires reasoning_content from previous turns to be passed back when thinking is enabled
    // OpenAI-format clients don't send it, so we inject a placeholder to satisfy the API requirement
    if (DEEPSEEK_THINKING_MODELS.has(model)) {
      const messages = body.messages.map(m => {
        if (m?.role === "assistant" && !("reasoning_content" in m) && (m?.content || m?.tool_calls)) {
          return { ...m, reasoning_content: KIMI_REASONING_PLACEHOLDER };
        }
        return m;
      });
      return { ...body, messages };
    }

    return body;
  }
}
