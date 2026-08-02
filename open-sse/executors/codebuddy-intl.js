import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    // CodeBuddy intl rejects requests without a system message (HTTP 400,
    // code 11101 "Parse message failed: invalid request"). Inject a minimal
    // system prompt when none is present.
    const messages = transformed.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const hasSystem = messages.some((m) => m?.role === "system");
      if (!hasSystem) {
        messages.unshift({ role: "system", content: "You are a helpful assistant." });
      }
    }

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }
    return transformed;
  }
}

export default CodeBuddyIntlExecutor;
