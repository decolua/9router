import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";
import { SSE_DONE } from "../utils/sseConstants.js";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE → JSON) downstream handlers in
 * 9router can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials) {
    body.stream = true;
    return body;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;
    // CommandCode returns HTTP 200 with an embedded error event when the
    // service is unavailable (e.g. {"type":"error","error":{"type":"server_error",
    // "statusCode":503,"isRetryable":true,...}}). Peek the first NDJSON line: if
    // it is a server error, fail the request with the embedded status instead of
    // streaming it as chat content — this lets chatCore mark the connection
    // unavailable so combo/account fallback picks the next model.
    const peek = await peekFirstCommandCodeFrame(result.response);
    if (peek?.isError) {
      await result.response.body?.cancel?.().catch?.(() => {});
      return {
        ...result,
        response: new Response(
          JSON.stringify({
            error: {
              message: peek.message,
              code: peek.status || "commandcode_error",
              type: "server_error",
            },
          }),
          {
            status: peek.status,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }
        ),
      };
    }
    // Hand the peeked bytes + reader to the wrapper — the body stream has
    // already been partially consumed, so the wrapper must seed from
    // `peek.consumed` and keep reading from the SAME reader (a body stream is
    // single-consumer; `pipeThrough` on it again would fail).
    result.response = await wrapNdjsonAsOpenAISse(opts.model, peek.consumed, peek.reader);
    return result;
  }

  parseError(response, bodyText) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      parsed = null;
    }
    const errObj = parsed?.error || parsed;
    const msg = errObj?.message || parsed?.message || bodyText || response.statusText;
    const status = Number(errObj?.code || errObj?.statusCode || response.status) || response.status;
    return {
      status,
      message: msg || `CommandCode upstream error: ${response.status}`,
    };
  }
}

export function parseCommandCodeError(event) {
  if (!event || typeof event !== "object") {
    return {
      statusCode: 503,
      message: "CommandCode upstream error",
      type: "server_error",
    };
  }

  const errVal = event.error ?? event.message ?? "unknown";
  let message = "";
  let statusCode = null;
  let type = "server_error";

  if (typeof errVal === "object" && errVal !== null) {
    message = errVal.message || errVal.error || JSON.stringify(errVal);
    if (errVal.statusCode && Number.isInteger(Number(errVal.statusCode))) {
      statusCode = Number(errVal.statusCode);
    } else if (errVal.status && Number.isInteger(Number(errVal.status))) {
      statusCode = Number(errVal.status);
    }
    if (errVal.type) type = errVal.type;
  } else if (typeof errVal === "string") {
    message = errVal;
  } else {
    message = JSON.stringify(errVal);
  }

  if (event.statusCode && Number.isInteger(Number(event.statusCode))) {
    statusCode = Number(event.statusCode);
  }

  if (!statusCode || statusCode < 400 || statusCode > 599) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests")) {
      statusCode = 429;
      type = "rate_limit_error";
    } else if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
      statusCode = 401;
      type = "authentication_error";
    } else if (lower.includes("payment required") || lower.includes("billing")) {
      statusCode = 402;
      type = "billing_error";
    } else if (lower.includes("quota") || lower.includes("forbidden") || lower.includes("permission")) {
      statusCode = 403;
      type = "permission_error";
    } else if (lower.includes("not found")) {
      statusCode = 404;
      type = "invalid_request_error";
    } else if (lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("server error")) {
      statusCode = 503;
      type = "server_error";
    } else {
      statusCode = 503;
    }
  }

  return { statusCode, message, type };
}

/**
 * Scan the leading CommandCode stream (before any client-visible content) to
 * detect an embedded error frame. Returns { isError, status, message, consumed,
 * reader } — `consumed` is every byte read so far and `reader` is the same
 * single-consumer reader, both passed on to the normal wrapper so nothing is
 * dropped from the stream.
 *
 * Only errors that appear BEFORE any content-producing frame (text-delta,
 * tool-input-*, tool-call) are treated as request-level failures — by then the
 * client has seen no output, so failing the request lets combo/account fallback
 * pick the next model. An error after content has started is returned as
 * `isError:false`; the translator maps it to a graceful mid-stream note.
 */
async function peekFirstCommandCodeFrame(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let consumed = "";

  const CONTENT_TYPES = new Set([
    "text-delta",
    "reasoning-delta",
    "tool-input-start",
    "tool-input-delta",
    "tool-call",
    "finish-step",
    "finish",
  ]);

  const parseEvent = (json) => {
    try {
      return JSON.parse(json.startsWith("data:") ? json.slice(5).trim() : json);
    } catch {
      return null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) return { isError: false, consumed, reader };
    consumed += decoder.decode(value, { stream: true });

    // Pull every complete line available right now.
    let nl;
    while ((nl = consumed.indexOf("\n")) !== -1) {
      const line = consumed.slice(0, nl).replace(/\r$/, "").trim();
      if (!line) {
        consumed = consumed.slice(nl + 1);
        continue;
      }
      const event = parseEvent(line);
      if (!event || typeof event !== "object") {
        consumed = consumed.slice(nl + 1);
        continue;
      }

      // Content-producing frame → stream is healthy. Leave this line IN
      // `consumed` (don't strip it) so the wrapper re-processes it — nothing
      // is dropped from the stream.
      if (event.type && CONTENT_TYPES.has(event.type)) {
        return { isError: false, consumed, reader };
      }

      // An error/status frame before any content → request-level failure.
      const isErrorEvent = event.type === "error";
      const errObj = isErrorEvent ? (event.error ?? event) : event;
      const status = Number(errObj.statusCode) || 0;
      const isServerError =
        isErrorEvent || errObj.type === "server_error" || errObj.isRetryable === true;
      if (isErrorEvent && (status >= 400 || isServerError)) {
        const message =
          typeof errObj.message === "string"
            ? errObj.message
            : `CommandCode upstream error (${status || "unknown"})`;
        return { isError: true, status: status >= 400 ? status : 503, message, consumed, reader };
      }
      // Otherwise (start / start-step / reasoning-start / metadata…) this line
      // carries no client-visible content — strip it and keep scanning.
      consumed = consumed.slice(nl + 1);
    }
  }
}

/**
 * Wrap a CommandCode NDJSON body into OpenAI chat.completion.chunk SSE.
 *
 * @param {string} model - upstream model id
 * @param {string} seedBuffer - bytes already pulled by the peek (first full line)
 * @param {ReadableStreamDefaultReader} reader - the (single-consumer) reader
 *   already attached to the upstream body; remaining bytes keep flowing through it.
 */
async function wrapNdjsonAsOpenAISse(model, seedBuffer = "", reader) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = seedBuffer || "";
  const state = { model };

  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c == null) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  // Process a full line (no trailing newline) into OpenAI chunks.
  const processLine = (line, controller) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller);
  };

  return new Response(
    new ReadableStream({
      // Use start()+loop (not pull): a pull that buffers a partial line without
      // enqueueing would never be re-invoked, hanging consumers like .text().
      async start(controller) {
        try {
          // Drain buffers that the peek already pulled off the socket.
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            processLine(line, controller);
          }
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              buffer += decoder.decode();
              if (buffer.length > 0) processLine(buffer, controller);
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            while ((nl = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 1);
              processLine(line, controller);
            }
          }
        } catch {
          // fall through to terminal [DONE] + close
        } finally {
          controller.enqueue(encoder.encode(SSE_DONE));
          try { controller.close(); } catch { /* already closed */ }
          await reader.cancel().catch(() => {});
        }
      },
      cancel() {
        return reader.cancel().catch(() => {});
      },
    }),
    {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    }
  );
}

export default CommandCodeExecutor;

// Test-only internals (mirrors the qoder executor's `__test__` convention). Do
// not rely on these outside tests.
export const __test__ = { peekFirstCommandCodeFrame, wrapNdjsonAsOpenAISse };
