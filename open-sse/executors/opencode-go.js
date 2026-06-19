import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const CLAUDE_FORMAT_MODELS = new Set(["minimax-m2.5", "minimax-m2.7"]);

const BASE = "https://opencode.ai/zen/go/v1";

// Valid reasoning effort levels (appended as model name suffix by clients)
const EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'];

function stripEffortSuffix(name) {
  if (!name) return { clean: name, effort: null };
  for (const level of EFFORT_LEVELS) {
    if (name.endsWith(`-${level}`)) {
      return { clean: name.slice(0, -(level.length + 1)), effort: level };
    }
  }
  return { clean: name, effort: null };
}

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(model) {
    const { clean } = stripEffortSuffix(model);
    this._lastModel = clean;
    return CLAUDE_FORMAT_MODELS.has(clean)
      ? `${BASE}/messages`
      : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (CLAUDE_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body) {
    // Extract reasoning effort from model name suffix
    const { clean: cleanBodyModel, effort: bodyEffort } = stripEffortSuffix(body.model);
    const { effort: paramEffort } = stripEffortSuffix(model);
    const modelEffort = bodyEffort || paramEffort;

    if (bodyEffort && body.model) {
      body.model = cleanBodyModel;
    }

    // Pass reasoning_effort in body for upstream (OpenAI-compatible format)
    if (!body.reasoning_effort && modelEffort) {
      body.reasoning_effort = modelEffort;
    }

    return injectReasoningContent({ provider: this.provider, model: body.model || model, body });
  }
}
