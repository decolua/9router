import { DefaultExecutor } from "./default.js";
import { sanitiseSystemMessage, NEUTRAL_PROMPT } from "./codebuddySanitise.js";

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

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request) and requires
    // the first message to be a system prompt — otherwise it answers 400
    // 11128 "first message is not system prompt". Probed against the live
    // gateway: caller system prompts are accepted and preserved, bare-string
    // user content is accepted, but a "developer" role is rejected outright
    // (11128 "Illegal API invocation from an unapproved channel"), so only
    // developer messages are dropped.
    //
    // Agent-identity system prompts (Claude Code, Cursor, etc.) also trigger
    // 11128 — sanitise those to NEUTRAL_PROMPT while preserving legitimate
    // user-supplied system prompts unchanged (see codebuddySanitise.js).
    //
    // Earlier this rebuilt the array from scratch with a hardcoded system
    // prompt, which silently discarded every caller system prompt. Preserve
    // them instead.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];

    // Drop developer-role messages (gateway rejects them outright), then
    // neutralise agent-identity system prompts.
    const messages = source
      .filter((m) => m && typeof m === "object" && m.role !== "developer")
      .map(sanitiseSystemMessage);

    // The gateway requires a leading system message; a developer message may
    // have been the caller's only instruction, so fall back to a neutral prompt
    // (never a branded identity — the caller's own system prompt is preserved
    // above, and this default must not assert a different agent).
    if (!messages.some((m) => m && m.role === "system")) {
      messages.unshift({ role: "system", content: NEUTRAL_PROMPT });
    }
    transformed.messages = messages;

    return transformed;
  }
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
