import { DefaultExecutor } from "./default.js";
import { CODEBUDDY_INTL_SYSTEM_PROMPT } from "../config/appConstants.js";
import { ROLE } from "../translator/schema/index.js";

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .filter((text) => text.trim())
    .join("\n");
}

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

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): it needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    // Keep the required identity first, but do not discard caller instructions.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    const callerInstructions = source
      .filter((message) => message && [ROLE.SYSTEM, ROLE.DEVELOPER].includes(message.role))
      .map((message) => contentToText(message.content))
      .filter((text) => text.trim());
    transformed.messages = [{
      role: ROLE.SYSTEM,
      content: [CODEBUDDY_INTL_SYSTEM_PROMPT, ...callerInstructions].join("\n\n"),
    }];
    for (const message of source) {
      if (!message || typeof message !== "object" || [ROLE.SYSTEM, ROLE.DEVELOPER].includes(message.role)) continue;
      if (message.role === ROLE.USER && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }
}

export default CodeBuddyIntlExecutor;
