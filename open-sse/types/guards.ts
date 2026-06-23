// open-sse/types/guards.ts
// Boundary-parser pattern: unknown IN, narrowed type OUT.
// All guard inputs are `unknown` — this is intentional; these functions sit at
// the I/O boundary (parseUpstreamError in error.js, mcpRequest in httpClient.js)
// where the caller receives raw JSON and must narrow before use.
//
// Imports:
import type { OpenAIErrorBody } from "./error.js";
import type { JsonRpcResponse } from "./mcp.js";

// ---------------------------------------------------------------------------
// Internal base guard (not exported — implementation detail)
// ---------------------------------------------------------------------------

/**
 * Returns true if `x` is a non-null object.
 * Base guard used by all other guards in this module.
 *
 * @example
 * // Inside parseUpstreamError (open-sse/utils/error.js):
 * //   const body = await response.json();  // unknown
 * //   if (isRecord(body) && isRecord(body.error)) { ... }
 */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// ---------------------------------------------------------------------------
// OpenAI error body guard
// ---------------------------------------------------------------------------

/**
 * Narrows `x` to `OpenAIErrorBody` — the exact shape returned by buildErrorBody()
 * in open-sse/utils/error.js (lines 15-21): `{ error: { message, type, code } }`.
 *
 * @example
 * // Boundary usage in parseUpstreamError (open-sse/utils/error.js):
 * //   const body: unknown = await response.json().catch(() => null);
 * //   if (isOpenAIErrorBody(body)) {
 * //     const typed: OpenAIErrorBody = body;  // safe — narrowed
 * //     return typed.error.message;
 * //   }
 */
export function isOpenAIErrorBody(x: unknown): x is OpenAIErrorBody {
  if (!isRecord(x)) return false;
  const err = x["error"];
  return isRecord(err) && typeof err["message"] === "string";
}

// ---------------------------------------------------------------------------
// Parsed provider error
// ---------------------------------------------------------------------------

/**
 * Attempts to parse `body` as an OpenAIErrorBody.
 * Returns the narrowed value or `null` if the shape doesn't match.
 * Callers use this to safely extract structured error info from upstream
 * responses whose shape is not guaranteed.
 *
 * @example
 * // Boundary usage in mcpRequest error handling (httpClient.js):
 * //   const raw: unknown = safeParseJson(text);
 * //   const parsed = parseProviderError(raw);
 * //   const msg = parsed ? parsed.error.message : String(raw);
 */
export function parseProviderError(body: unknown): OpenAIErrorBody | null {
  return isOpenAIErrorBody(body) ? body : null;
}

// ---------------------------------------------------------------------------
// JSON-RPC response guard
// ---------------------------------------------------------------------------

/**
 * Narrows `x` to `JsonRpcResponse` — checks:
 *   1. `x` is a non-null object
 *   2. `x.jsonrpc === '2.0'`
 *   3. Exactly one of `result` or `error` is present (XOR)
 *
 * The XOR invariant matches the JSON-RPC 2.0 spec and the discriminated union
 * in JsonRpcResponse<T>.
 *
 * @example
 * // Boundary usage in mcpRequest (httpClient.js) after parseResponsePayload:
 * //   const frames: unknown[] = parseResponsePayload(res, text);
 * //   const frame = frames.find(isJsonRpcResponse);
 * //   if (frame) {
 * //     if ('error' in frame) throw new Error(frame.error.message);
 * //     return frame.result;
 * //   }
 */
export function isJsonRpcResponse(x: unknown): x is JsonRpcResponse {
  if (!isRecord(x)) return false;
  if (x["jsonrpc"] !== "2.0") return false;
  const hasResult = "result" in x;
  const hasError = "error" in x;
  // XOR: exactly one must be present
  return hasResult !== hasError;
}
