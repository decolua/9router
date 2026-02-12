import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/constants.js";

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 * Automatically injects default instructions if missing
 */
export class CodexExecutor extends BaseExecutor {
  constructor() {
    super("codex", PROVIDERS.codex);
  }

  /**
   * Override headers to add session_id per request
   */
  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    headers["session_id"] = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    return headers;
  }

  /**
   * Transform request before sending - inject default instructions if missing
   */
  transformRequest(model, body, stream, credentials) {
    // Ensure input is present and non-empty (Codex API rejects empty input)
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }

    // Ensure streaming is enabled (Codex API requires it)
    body.stream = true;

    // If no instructions provided, inject default Codex instructions
    if (!body.instructions || body.instructions.trim() === "") {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    // Ensure store is false (Codex requirement)
    body.store = false;

    // Extract thinking level from model name suffix
    // e.g., gpt-5.3-codex-high → high, gpt-5.3-codex → medium (default)
    const effortLevels = ['none', 'low', 'medium', 'high', 'xhigh'];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (model.endsWith(`-${level}`)) {
        modelEffort = level;
        // Strip suffix from model name for actual API call
        body.model = body.model.replace(`-${level}`, '');
        break;
      }
    }

    // Priority: explicit reasoning.effort > reasoning_effort param > model suffix > default (medium)
    if (!body.reasoning) {
      const effort = body.reasoning_effort || modelEffort || 'medium';
      body.reasoning = { effort, summary: "auto" };
    } else if (!body.reasoning.summary) {
      body.reasoning.summary = "auto";
    }
    delete body.reasoning_effort;

    // Include reasoning encrypted content (required by Codex backend for reasoning models)
    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
    }

    // Remove unsupported parameters for Codex API
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.user; // Cursor sends this but Codex doesn't support it
    delete body.prompt_cache_retention; // Cursor sends this but Codex doesn't support it
    delete body.metadata; // Cursor sends this but Codex doesn't support it
    delete body.stream_options; // Cursor sends this but Codex doesn't support it
    delete body.safety_identifier; // Droid CLI sends this but Codex doesn't support it

    return body;
  }
}
