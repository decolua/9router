import { createHash, randomUUID } from "node:crypto";
import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */

// Deterministic RFC-4122-v5-shaped UUID derived from a session key, mirroring
// the official client's per-conversation id (uuid5 over the session key).
function stableUuidFrom(key) {
  const hash = createHash("sha1").update(key).digest("hex");
  const timeHigh = ((parseInt(hash.slice(12, 16), 16) & 0x0fff) | 0x5000)
    .toString(16)
    .padStart(4, "0");
  const clockSeq = ((parseInt(hash.slice(16, 20), 16) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    timeHigh,
    clockSeq,
    hash.slice(20, 32),
  ].join("-");
}

export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  // Upstream "channel verification" (HTTP 400 code 11128 "conversation id
  // missing", 9router #4892): the intl gateway now rejects any request that
  // does not carry the X-Conversation-* header family the official IDE sends
  // on every turn — a conversation id derived stably from the session key,
  // plus fresh UUIDs for the request and the message. Verified A/B against
  // the live upstream: same credentials and body, headers absent -> 11128,
  // headers present -> 200 SSE. codebuddy-cn (copilot.tencent.com) is not
  // gated yet, so only the intl executor grows these headers.
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);

    // Stable per-conversation id: prefer whatever session key the client sent,
    // else derive from the opening user message (stable across retries of the
    // same turn and across accounts), else fall back to a random UUID.
    const sessionKey =
      (typeof body?.session_id === "string" && body.session_id) ||
      (typeof body?.prompt_cache_key === "string" && body.prompt_cache_key) ||
      (typeof body?.conversation_id === "string" && body.conversation_id) ||
      null;
    const firstUser = Array.isArray(body?.messages)
      ? body.messages.find((m) => m?.role === "user")
      : null;
    const userText =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? firstUser.content
              .map((b) => (b && typeof b.text === "string" ? b.text : ""))
              .join("\n")
          : "";
    const conversationKey = sessionKey || (userText ? `cbai:${userText}` : null);

    headers["X-Conversation-ID"] = conversationKey
      ? stableUuidFrom(conversationKey)
      : randomUUID();
    headers["X-Conversation-Request-ID"] = randomUUID();
    headers["X-Conversation-Message-ID"] = randomUUID();

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
