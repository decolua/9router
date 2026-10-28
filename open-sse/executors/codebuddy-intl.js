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

// Read a header case-insensitively. HTTP header names are case-insensitive, so a
// caller that already sent `x-conversation-id` must be found — testing the exact
// key would miss it, add a second `X-Conversation-ID`, and undici would then join
// both into one comma-separated value ("caller, ours"), corrupting the id we are
// supposed to keep stable. Accepts a plain object (the executor path) or a fetch
// `Headers` instance (whose get/set are already case-insensitive). A non-object
// input means "no headers", not an error.
function readHeader(headers, name) {
  if (typeof headers?.get === "function") {
    const value = headers.get(name);
    return typeof value === "string" ? value.trim() : "";
  }
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

// Write a header, updating the caller's existing key when only the case differs
// rather than adding a duplicate.
function writeHeader(headers, name, value) {
  if (typeof headers?.set === "function") {
    headers.set(name, value);
    return;
  }
  if (!headers || typeof headers !== "object") return;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  // Normalize to canonical casing: drop a differently-cased existing key so
  // we never leave a duplicate, then store under the canonical name.
  if (key && key !== name) delete headers[key];
  headers[name] = value;
}

/**
 * Attach the conversation-correlation family the gateway's channel verification
 * demands (HTTP 400 code 11128 "conversation id missing" without it). Values
 * that already exist and are non-empty are preserved, so a caller tracking its
 * own conversation keeps it; blank values count as absent.
 *
 * **All three of `X-Conversation-ID`, `X-Conversation-Request-ID` and
 * `X-Conversation-Message-ID` are required** — verified A/B against the live
 * gateway, where any two of them are still answered 11128. `X-Request-ID` is
 * NOT part of the requirement; it is mirrored from the message id because the
 * official client sends it.
 *
 * - `X-Conversation-ID`: derived stably from the session key (or the opening
 * user message), so retries of a turn and later turns of one conversation
 * keep the id; a fresh UUID when nothing is derivable.
 * - `X-Conversation-Request-ID` / `X-Conversation-Message-ID`: fresh per
 * request, and `X-Request-ID` mirrors the message id.
 */
export function withConversationHeaders(headers, body = null) {
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

  if (!readHeader(headers, "X-Conversation-ID")) {
    writeHeader(
      headers,
      "X-Conversation-ID",
      conversationKey ? stableUuidFrom(conversationKey) : randomUUID(),
    );
  }
  if (!readHeader(headers, "X-Conversation-Request-ID")) {
    writeHeader(headers, "X-Conversation-Request-ID", randomUUID());
  }
  // The request id mirrors the message id: reuse whichever side already exists.
  const messageId =
    readHeader(headers, "X-Conversation-Message-ID") ||
    readHeader(headers, "X-Request-ID") ||
    randomUUID();
  if (!readHeader(headers, "X-Conversation-Message-ID")) {
    writeHeader(headers, "X-Conversation-Message-ID", messageId);
  }
  if (!readHeader(headers, "X-Request-ID")) {
    writeHeader(headers, "X-Request-ID", messageId);
  }

  // Normalize header keys to canonical casing (in case caller passed
  // lowercase variants). The caller's value is preserved; only the key
  // casing changes so downstream sees canonical "X-Conversation-*".
  for (const canonical of [
    "X-Conversation-ID",
    "X-Conversation-Request-ID",
    "X-Conversation-Message-ID",
    "X-Request-ID",
  ]) {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === canonical.toLowerCase());
    if (key && key !== canonical) {
      headers[canonical] = headers[key];
      delete headers[key];
    }
  }
  return headers;
}

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

    // Preserve session identifiers that the gateway may require in the request body
    // (session_id / prompt_cache_key / conversation_id). These are used by the
    // gateway for conversation tracking and must be forwarded, not just used for
    // X-Conversation-ID header generation.
    for (const key of ["session_id", "prompt_cache_key", "conversation_id"]) {
      if (body && typeof body[key] === "string" && body[key]) {
        transformed[key] = body[key];
      }
    }

    return transformed;
  }

  buildHeaders(credentials, stream, url, model, body) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    // Fails closed: buildHeaders runs OUTSIDE the fetch try/catch in base.js.
    // An unexpected error surfaces as a generic 502 with no cause.
    // A silent fall-through to "send without the family" would be worse:
    // such a request is refused every time. The throw names the gate instead.
    return withConversationHeaders(headers, body);
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
        // Code 11128 is overloaded: it also carries "first message is not system
        // prompt" (a body-shape problem fixed in transformRequest) and
        // "request illegal" (channel verification gate). Only the
        // conversation-id / request-illegal variants are channel verification,
        // so branch on the message, never on the code alone — otherwise the
        // failure reads as a generic 400 and the cause has to be rediscovered.
        if (data?.code === 11128 && /conversation id missing|request illegal/i.test(msg)) {
          const tip = data?.displayTips?.en || data?.displayMsg?.en || "";
          const variant = /conversation id missing/i.test(msg) ? "conversation id missing" : "request illegal";
          return {
            status: 400,
            message:
              `CodeBuddy channel verification failed (11128 "${variant}"): ` +
              "the upstream gateway requires the X-Conversation-* header family the official " +
              "IDE sends, supplied by CodeBuddyIntlExecutor.buildHeaders(). If this appears, " +
              "the gate likely changed (e.g. a new required header)." +
              (tip ? ` Upstream said: ${tip}` : ""),
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;