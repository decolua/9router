import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";
import type { OpenAIErrorBody, ErrorEnvelope, ErrorType, ErrorCode } from "../types/error.js";
import type { ExecutorError, ExecutorSuccess, ExecutorResult, JsonValue } from "../types/executor.js";
import type { StreamWriter } from "../types/stream.js";
import { isOpenAIErrorBody } from "../types/guards.js";

/**
 * Build OpenAI-compatible error response body
 */
export function buildErrorBody(statusCode: number, message: string): OpenAIErrorBody {
  const errorInfo = (ERROR_TYPES as Record<number, { type: string; code: string }>)[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || (DEFAULT_ERROR_MESSAGES as Record<number, string>)[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code,
    },
  };
}

/**
 * Create error Response object (for non-streaming)
 */
export function errorResponse(statusCode: number, message: string): Response {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Write error to SSE stream (for streaming)
 */
export async function writeStreamError(writer: StreamWriter, statusCode: number, message: string): Promise<void> {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await (writer as StreamWriter & { write(chunk: Uint8Array): void | Promise<void> }).write(
    encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`),
  );
}

/**
 * Parsed upstream error shape returned by parseUpstreamError
 */
interface ParsedUpstreamError {
  statusCode: number;
  message: string;
  resetsAtMs?: number;
}

/**
 * Executor interface subset — only what parseUpstreamError needs
 */
interface ErrorParserExecutor {
  parseError?: (response: Response, bodyText: string) => { message?: string; status?: number; resetsAtMs?: number } | null | undefined;
}

/**
 * Parse upstream provider error response.
 * Input is `unknown` — this is the documented I/O boundary; narrowed via isOpenAIErrorBody.
 */
export async function parseUpstreamError(response: Response, executor: ErrorParserExecutor | null = null): Promise<ParsedUpstreamError> {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor !== null && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed !== null && parsed !== undefined && typeof parsed === "object") {
        const defaultMsg = (DEFAULT_ERROR_MESSAGES as Record<number, string>)[response.status];
        const msg = parsed.message || defaultMsg || `Upstream error: ${response.status}`;
        return { statusCode: parsed.status || response.status, message: msg, resetsAtMs: parsed.resetsAtMs } as ParsedUpstreamError;
      }
    } catch { /* fall through to default parsing */ }
  }

  let messageStr = "";
  try {
    // json is `unknown` at the I/O boundary — narrowed immediately before use
    const json: unknown = JSON.parse(bodyText);
    if (typeof json === "object" && json !== null) {
      const rec = json as Record<string, JsonValue>;
      // Use guard to extract error.message; fall through via || to match original JS behavior
      const errMsg = isOpenAIErrorBody(json) ? json.error.message : undefined;
      const raw = errMsg || rec["message"] || rec["error"] || bodyText;
      messageStr = typeof raw === "string" ? raw : JSON.stringify(raw);
    } else {
      messageStr = bodyText;
    }
  } catch {
    messageStr = bodyText;
  }

  const defaultMsg = (DEFAULT_ERROR_MESSAGES as Record<number, string>)[response.status];
  const finalMessage = messageStr || defaultMsg || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler.
 * Return type implements ExecutorError exactly (wave-1 interface is the source of truth).
 */
export function createErrorResult(statusCode: number, message: string, resetsAtMs?: number): ExecutorError {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message),
  } as ExecutorError;
}

/**
 * Create unavailable response when all accounts are rate limited
 */
export function unavailableResponse(
  statusCode: number,
  message: string,
  retryAfter: string,
  retryAfterHuman: string,
): Response {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

/**
 * Format provider error with context
 */
export function formatProviderError(
  error: Error & { code?: string; cause?: { code?: string; message?: string } },
  provider: string,
  model: string,
  statusCode: number | string,
): string {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
