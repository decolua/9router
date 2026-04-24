import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig";

interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * Build OpenAI-compatible error response body
 */
export function buildErrorBody(statusCode: number, message?: string): ErrorResponse {
  const errorInfo = (ERROR_TYPES as any)[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || (DEFAULT_ERROR_MESSAGES as any)[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

/**
 * Create error Response object (for non-streaming)
 */
export function errorResponse(statusCode: number, message?: string): Response {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * Write error to SSE stream (for streaming)
 */
export async function writeStreamError(writer: WritableStreamDefaultWriter, statusCode: number, message?: string): Promise<void> {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Parse upstream provider error response
 */
export async function parseUpstreamError(response: Response): Promise<{statusCode: number, message: string}> {
  let message: any = "";
  const status = response.status || 502;

  try {
    const text = await response.text();

    try {
      const json = JSON.parse(text);
      message = json.error?.message || json.message || json.error || text;
    } catch {
      message = text;
    }
  } catch {
    message = `Upstream error: ${status}`;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || (DEFAULT_ERROR_MESSAGES as any)[status] || `Upstream error: ${status}`;

  return {
    statusCode: status,
    message: finalMessage
  };
}

export interface ErrorResult {
  success: false;
  status: number;
  error: string;
  response: Response;
}

/**
 * Create error result for chatCore handler
 */
export function createErrorResult(statusCode: number, message: string): ErrorResult {
  return {
    success: false,
    status: statusCode,
    error: message,
    response: errorResponse(statusCode, message)
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 */
export function unavailableResponse(statusCode: number, message: string, retryAfter: string, retryAfterHuman: string): Response {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
    }
  );
}

/**
 * Format provider error with context
 */
export function formatProviderError(error: any, provider: string, model: string, statusCode?: number | string): string {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
