import { DefaultExecutor } from "./default.js";
import {
  sanitizeChatBody,
  createSseNormalizeTransform,
} from "../protocol/codebuddy/index.js";

/**
 * CodeBuddyExecutor — thin adapter over protocol/codebuddy.
 *
 * Upstream: OpenAI Chat Completions at copilot.tencent.com/v2/chat/completions.
 * Wire rules (allowlist, reasoning gate, stream force, SSE dirt) live in protocol/.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  transformRequest(model, body, stream, credentials) {
    // DefaultExecutor: json_schema fallback + stripUnsupportedParams + injectReasoningContent
    // (injector is a no-op for this provider). Then protocol allowlist.
    const base = super.transformRequest(model, body, stream, credentials);
    return sanitizeChatBody(base && typeof base === "object" ? base : body);
  }

  async execute(opts) {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;

    const normalized = result.response.body.pipeThrough(createSseNormalizeTransform());
    const response = new Response(normalized, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: result.response.headers,
    });
    return { ...result, response };
  }
}

