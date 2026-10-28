import { randomBytes } from "node:crypto";
import { DefaultExecutor } from "./default.js";

/**
 * RFC 9562 UUIDv7: 48-bit millisecond timestamp first, then random bits.
 *
 * The desktop client's request / message ids are this shape (dashed UUID whose
 * version nibble is 7); dropping the dashes yields the 32-hex form the gateway
 * actually puts in the request headers.
 */
function uuid7() {
  const buf = randomBytes(16);
  const ms = Date.now();
  buf[0] = (ms / 2 ** 40) & 0xff;
  buf[1] = (ms / 2 ** 32) & 0xff;
  buf[2] = (ms / 2 ** 24) & 0xff;
  buf[3] = (ms / 2 ** 16) & 0xff;
  buf[4] = (ms / 2 ** 8) & 0xff;
  buf[5] = ms & 0xff;
  buf[6] = (buf[6] & 0x0f) | 0x70; // version 7
  buf[8] = (buf[8] & 0x3f) | 0x80; // RFC variant
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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

  /**
   * The gateway's channel check reads the request's conversation header family.
   * A chat request that carries none of it is rejected with HTTP 400 /
   * code 11-128 (`conversation id missing`, displayTips「这次调用没通过渠道
   * 校验，可能不是官方客户端发出的」). The desktop client sends all four:
   *
   *   X-Conversation-ID          dashed UUID
   *   X-Conversation-Request-ID  32 hex  (same value as X-Root-Request-ID)
   *   X-Root-Request-ID          32 hex
   *   X-Conversation-Message-ID  32 hex  (same value as X-Request-ID)
   *   X-Request-ID               32 hex
   *
   * plus the W3C/B3 trace family, which the client derives from the same
   * traceparent. Upstream keeps no history under the conversation id — a fresh
   * id per call is accepted (verified against the 5.8.4 capture), so no
   * cross-request session state is needed here.
   */
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);

    const convId = uuid7();
    const convReqId = uuid7().replace(/-/g, "");
    const msgId = uuid7().replace(/-/g, "");
    const trace = uuid7().replace(/-/g, "");
    const span = randomBytes(8).toString("hex");

    headers["X-Conversation-ID"] = convId;
    headers["X-Conversation-Request-ID"] = convReqId;
    headers["X-Root-Request-ID"] = convReqId;
    headers["X-Conversation-Message-ID"] = msgId;
    headers["X-Request-ID"] = msgId;

    headers["X-Trace-ID"] = trace;
    headers["traceparent"] = `00-${trace}-${span}-01`;
    headers["b3"] = `${trace}-${span}-1`;
    headers["X-B3-TraceId"] = trace;
    headers["X-B3-SpanId"] = span;
    headers["X-B3-Sampled"] = "1";

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
