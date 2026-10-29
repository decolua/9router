// Executor/upstream protocol-mismatch guard (DF-9ROUTER-30).
//
// An executor speaks ONE upstream wire protocol. Point `ollama-local` (native
// Ollama `/api/chat`, NDJSON: one bare JSON object per line) at an OpenAI-shaped
// server and the server answers 200 with a body the executor cannot parse: the
// NDJSON parser returns null for every `data:`/`{"choices":…}` line, the SSE
// transform emits nothing, and the client receives HTTP 200 + `data: [DONE]`
// with zero tokens while the central log prints a normal-looking
// `DONE 500ms · TTFT 499ms · IN 0 · OUT 0`. Nothing distinguishes "the model
// produced nothing" from "the protocols disagree".
//
// This module answers exactly one question, BEFORE any byte reaches the client:
// does the upstream's first line look like a DIFFERENT protocol family than the
// one this executor spoke? The decision is deliberately conservative —
//
//   * only a RECOGNIZED foreign shape counts (an unparseable or absent first
//     line is NOT a mismatch; it fails open to today's behavior),
//   * protocols that agree are untouched, including a legitimately empty but
//     protocol-valid completion (`{"message":{"content":""},"done":true,…}` for
//     an Ollama executor, `data: {…"finish_reason":"stop"}…` for an OpenAI one),
//   * the caller additionally requires zero assistant output before failing loud.
//
// The peer of this guard for the non-streaming path is the same classifier fed
// the parsed JSON body instead of the first raw line.

import { FORMATS } from "../../translator/formats.js";
import { PROTOCOL_PEEK_TIMEOUT_MS, HTTP_STATUS } from "../../config/runtimeConfig.js";

// Client-facing error code for the fail-loud path (HTTP 502).
export const PROTOCOL_MISMATCH_CODE = "protocol_mismatch";

// Marks a Response whose body has already been probed, so the peek can never run
// twice on the same object (the guard is memoized on the response it rewrapped).
export const PROTOCOL_PEEKED = Symbol.for("9router.protocolMismatch.peeked");

// Wire-protocol families an executor can speak to its upstream.
export const PROTOCOL_FAMILY = {
  OLLAMA_NDJSON: "ollama-native-ndjson", // bare JSON lines (Ollama /api/chat|/api/generate)
  FRAMED: "sse-or-json",                 // `data:`/`event:` framing, or a JSON body
};

// Shape a single upstream line (or a parsed upstream body) can have.
export const PROTOCOL_SHAPE = {
  OLLAMA_NDJSON: "ollama-native-ndjson",
  OPENAI_JSON: "openai-chat-json",
  SSE: "sse-framed",
  UNKNOWN: "unknown",
};

// Cap for the diagnostic copy in the client-facing message / log line.
const SNIPPET_MAX_CHARS = 200;
// Safety valve for a body that never emits a newline: stop peeking after this much.
const PEEK_MAX_BYTES = 8 * 1024;

/**
 * Which wire-protocol family does an executor that reported this upstream format
 * speak?
 * @param {string} responseFormat - format the request was translated INTO (targetFormat)
 * @returns {string} PROTOCOL_FAMILY.*
 */
export function expectedFamilyFor(responseFormat) {
  return responseFormat === FORMATS.OLLAMA ? PROTOCOL_FAMILY.OLLAMA_NDJSON : PROTOCOL_FAMILY.FRAMED;
}

/**
 * Does this JSON payload carry the native-Ollama markers
 * (`message` for /api/chat, `response` for /api/generate, `done` + counts)?
 * An OpenAI-shaped body is explicitly excluded so `{object:"chat.completion"}`
 * can never be read as an Ollama chunk.
 */
function looksOllamaNative(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (Array.isArray(obj.choices) || typeof obj.object === "string") return false;
  if (obj.message && typeof obj.message === "object") return true;
  if (typeof obj.response === "string") return true;
  return obj.done !== undefined && (obj.model !== undefined || obj.done_reason !== undefined || obj.eval_count !== undefined || obj.prompt_eval_count !== undefined);
}

/**
 * OpenAI Chat Completions / error-envelope shape: `choices[]`, an `object`
 * discriminator, or a top-level `error` (what gateways answer at HTTP 200 with).
 */
function looksOpenAI(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (Array.isArray(obj.choices)) return true;
  if (typeof obj.object === "string") return true;
  return obj.error !== undefined;
}

function firstNonEmptyLine(text) {
  for (const line of String(text || "").split("\n")) {
    if (line.trim()) return line.trim();
  }
  return "";
}

/**
 * Classify a raw upstream text payload (first line is what matters) into a
 * PROTOCOL_SHAPE.
 */
export function classifyPayload(text) {
  const line = firstNonEmptyLine(text);
  if (!line) return PROTOCOL_SHAPE.UNKNOWN;

  // SSE framing: `data: …`, `event: …`, or a `: keep-alive` comment line.
  if (line.startsWith("data:") || line.startsWith("event:") || line.startsWith(":")) return PROTOCOL_SHAPE.SSE;

  if (!line.startsWith("{")) return PROTOCOL_SHAPE.UNKNOWN;

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return PROTOCOL_SHAPE.UNKNOWN;
  }
  return classifyBody(obj);
}

/**
 * Classify an already-parsed upstream body (non-streaming path).
 */
export function classifyBody(obj) {
  if (looksOllamaNative(obj)) return PROTOCOL_SHAPE.OLLAMA_NDJSON;
  if (looksOpenAI(obj)) return PROTOCOL_SHAPE.OPENAI_JSON;
  return PROTOCOL_SHAPE.UNKNOWN;
}

/**
 * Decide whether a payload the executor just received belongs to a DIFFERENT
 * protocol family than the one it spoke.
 *
 * @param {object} args
 * @param {string} args.responseFormat - format the executor spoke (targetFormat)
 * @param {string|object} args.payload - first raw upstream line (streaming) or parsed body
 * @returns {{mismatch: boolean, expected: string, observed: string}}
 */
export function classifyProtocolMismatch({ responseFormat, payload }) {
  const expected = expectedFamilyFor(responseFormat);
  const observed = typeof payload === "object" && payload !== null
    ? classifyBody(payload)
    : classifyPayload(payload);

  if (observed === PROTOCOL_SHAPE.UNKNOWN) return { mismatch: false, expected, observed };

  if (expected === PROTOCOL_FAMILY.OLLAMA_NDJSON) {
    const foreign = observed === PROTOCOL_SHAPE.OPENAI_JSON || observed === PROTOCOL_SHAPE.SSE;
    return { mismatch: foreign, expected, observed };
  }

  // Framed executors (OpenAI / Claude / Gemini / Responses …) must not be
  // answered by a bare-NDJSON Ollama server.
  return { mismatch: observed === PROTOCOL_SHAPE.OLLAMA_NDJSON, expected, observed };
}

/**
 * Clamp untrusted upstream text for a client-facing message / log line, the same
 * way the non-SSE gate in streamingHandler sanitizes an upstream HTML title.
 */
export function snippet(value, max = SNIPPET_MAX_CHARS) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return String(text || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

/**
 * Upstream target for the diagnostic: origin + path only (no query, no creds).
 */
export function sanitizeUpstreamTarget(url) {
  if (!url) return "unknown upstream";
  try {
    const parsed = new URL(String(url));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return snippet(String(url), 120);
  }
}

/**
 * Build the client-facing protocol-mismatch message. Names the executor, the
 * upstream target, the upstream status/content-type, the shape the executor
 * expected and the one it observed, and quotes the upstream's own first line.
 */
export function buildProtocolMismatchMessage({ provider, expected, observed, status, contentType, url, firstLine }) {
  const target = sanitizeUpstreamTarget(url);
  const ct = contentType ? ` content-type=${contentType}` : "";
  return `protocol_mismatch: the ${provider} executor speaks ${expected} but ${target} answered HTTP ${status}${ct} with ${observed} — no completion was produced. Upstream said: "${snippet(firstLine)}"`;
}

/**
 * Does this upstream body carry assistant output? Exported for callers that
 * already hold a parsed body (the non-streaming path) and want the explicit
 * zero-output check to sit NEXT to the classification instead of being inferred
 * from it.
 */
export function hasAssistantOutput(body) {
  if (!body || typeof body !== "object") return false;
  if (Array.isArray(body.choices)) {
    for (const choice of body.choices) {
      if (Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0) return true;
      if (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0) return true;
    }
  }
  if (Array.isArray(body.message?.tool_calls) && body.message.tool_calls.length > 0) return true;
  if (Array.isArray(body.content) && body.content.some(block => block?.type === "tool_use")) return true;
  return false;
}

// A recognized FOREIGN shape is zero-output BY CONSTRUCTION for the executor that
// received it, which is exactly why the defect was silent: the NDJSON parser
// (parseSSELine + FORMATS.OLLAMA) returns null for every `data:`/OpenAI line, and
// the OpenAI path reads `parsed.message.content` / `parsed.response`, which a
// `choices[]` body does not carry. The classifier above is therefore the whole
// zero-output test — a foreign shape cannot produce content tokens, and a shape
// that CAN produce content tokens is by definition not foreign. Keep this
// invariant in mind if a future executor learns a hybrid dialect: it must decide
// "the upstream was foreign AND produced nothing" rather than reusing the
// classifier alone.

/**
 * Read the upstream body up to its FIRST line and hand back a stream that
 * replays every byte — the peek must be lossless, so the returned stream owns
 * the reader and re-emits the raw chunks that were consumed (bytes are never
 * decoded/re-encoded; the decoded text is only used for classification).
 *
 * Bounded by `timeoutMs`: on timeout it returns whatever arrived (line may be
 * null) so the caller can fail open and stream as before.
 *
 * @param {ReadableStream} body
 * @param {number} timeoutMs
 * @returns {Promise<{line: string|null, stream: ReadableStream, timedOut: boolean}>}
 */
export async function peekFirstLine(body, timeoutMs = PROTOCOL_PEEK_TIMEOUT_MS) {
  if (!body || typeof body.getReader !== "function") return { line: null, stream: body, timedOut: false, excerpt: "" };

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks = [];
  let text = "";
  let line = null;
  let timedOut = false;
  let bytes = 0;
  let sawNewline = false;

  try {
    while (bytes < PEEK_MAX_BYTES) {
      let timer = null;
      const result = await Promise.race([
        reader.read(),
        new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });

      if (result === "timeout") { timedOut = true; break; }
      if (!result || result.done) break;

      chunks.push(result.value);
      bytes += result.value?.byteLength || result.value?.length || 0;
      text += decoder.decode(result.value, { stream: true });

      const lf = text.indexOf("\n");
      const cr = text.indexOf("\r");
      const idx = lf >= 0 && cr >= 0 ? Math.min(lf, cr) : (lf >= 0 ? lf : cr);
      if (idx >= 0) { line = text.slice(0, idx); sawNewline = true; break; }
    }

    // A body that closed (or a byte-capped read) without a newline still carries
    // a complete line: the peek hit EOF, so what we hold IS the first line.
    if (!sawNewline && text.trim()) line = text;
  } catch {
    // An upstream that dies mid-peek is not a mismatch; replay what we have and
    // let the normal stream path surface the transport error.
  }

  const replayed = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        try { controller.enqueue(chunk); } catch { /* downstream already closed */ }
      }
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      try { reader.cancel(reason).catch(() => {}); } catch { /* already released */ }
    },
  });

  // `excerpt` is what the caller quotes when there is no complete line yet (a
  // timed-out peek): the best raw evidence available, already clamped.
  const excerpt = snippet(line ?? text);
  return { line, excerpt, stream: replayed, timedOut };
}

/**
 * Error result for the fail-loud path: 502 with the repo's OpenAI-compatible
 * error envelope and an explicit `protocol_mismatch` machine code, so a client
 * (and the central log row) can tell a protocol disagreement from an ordinary
 * upstream 5xx. Mirrors createErrorResult() but states the code.
 */
export function protocolMismatchResult(message) {
  return {
    success: false,
    status: HTTP_STATUS.BAD_GATEWAY,
    error: message,
    code: PROTOCOL_MISMATCH_CODE,
    response: new Response(JSON.stringify({
      error: {
        message,
        type: "server_error",
        code: PROTOCOL_MISMATCH_CODE,
      },
    }), {
      status: HTTP_STATUS.BAD_GATEWAY,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

/** Can this status carry a body? (guards the re-wrapped Response) */
export function statusAllowsBody(status) {
  return status !== 204 && status !== 205 && status !== 304;
}
