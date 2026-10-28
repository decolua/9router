import crypto from "crypto";
import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 *
 * The intl gateway additionally gates every chat request on the
 * `X-Conversation-*` header family the official IDE sends. Without all three
 * ids it answers HTTP 400 code 11128 ("request illegal" / "conversation id
 * missing") before the model is ever reached, so buildHeaders() injects them.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  /**
   * The intl gateway runs a channel-verification check before routing and needs
   * the `X-Conversation-*` header family the official IDE sends. Omitting any of
   * the three ids yields HTTP 400 code 11128 ("request illegal" / "conversation
   * id missing") on every model, regardless of how valid the credentials are.
   *
   * - X-Conversation-ID stays stable per connection so upstream prompt/KV cache
   *   buckets survive across turns.
   * - X-Conversation-Request-ID and X-Conversation-Message-ID are fresh per
   *   request, mirroring the IDE's one-request-one-message behavior.
   */
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    const seed = credentials?.connectionId || credentials?.email || credentials?.apiKey || "";
    const conversationId = seed
      ? crypto.createHash("sha256").update(`codebuddy-intl\u0000${seed}`).digest("hex").slice(0, 32)
      : crypto.randomUUID().replace(/-/g, "");
    headers["X-Conversation-ID"] = conversationId;
    headers["X-Conversation-Request-ID"] = crypto.randomUUID();
    headers["X-Conversation-Message-ID"] = crypto.randomUUID();
    return headers;
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

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

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
