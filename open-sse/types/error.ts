// open-sse/types/error.ts
// Anchors: open-sse/utils/error.js (buildErrorBody return shape),
//          open-sse/config/errorConfig.js (ERROR_TYPES map).
//
// ERROR_TYPES is keyed by numeric status codes; values have shape { type, code }.
// checkJs:false means the .js import widens to { type: string; code: string }.
// We assert to the concrete literal anchor type so ErrorType/ErrorCode are narrow.

import { ERROR_TYPES as _ERROR_TYPES } from "../config/errorConfig.js";

/** Literal-typed anchor for ERROR_TYPES — mirrors errorConfig.js exactly. */
type ErrorTypesAnchor = {
  readonly 400: { readonly type: "invalid_request_error"; readonly code: "bad_request" };
  readonly 401: { readonly type: "authentication_error";  readonly code: "invalid_api_key" };
  readonly 402: { readonly type: "billing_error";         readonly code: "payment_required" };
  readonly 403: { readonly type: "permission_error";      readonly code: "insufficient_quota" };
  readonly 404: { readonly type: "invalid_request_error"; readonly code: "model_not_found" };
  readonly 406: { readonly type: "invalid_request_error"; readonly code: "model_not_supported" };
  readonly 429: { readonly type: "rate_limit_error";      readonly code: "rate_limit_exceeded" };
  readonly 500: { readonly type: "server_error";          readonly code: "internal_server_error" };
  readonly 502: { readonly type: "server_error";          readonly code: "bad_gateway" };
  readonly 503: { readonly type: "server_error";          readonly code: "service_unavailable" };
  readonly 504: { readonly type: "server_error";          readonly code: "gateway_timeout" };
};

/** Compile-time guard: fails if errorConfig.js adds/removes status keys. */
type KeysEqual<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _keysCheck: KeysEqual<typeof _ERROR_TYPES, ErrorTypesAnchor> = true;

/** Runtime ERROR_TYPES with full literal inference via anchor assertion. */
export const ERROR_TYPES = _ERROR_TYPES as unknown as ErrorTypesAnchor;

type ErrorEntry = (typeof ERROR_TYPES)[keyof typeof ERROR_TYPES];

/** Literal union of all `type` strings from ERROR_TYPES in errorConfig.js. */
export type ErrorType = ErrorEntry["type"];

/** Literal union of all `code` strings from ERROR_TYPES in errorConfig.js. */
export type ErrorCode = ErrorEntry["code"];

/** Exact shape returned by buildErrorBody() in open-sse/utils/error.js lines 15-21. */
export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * General error envelope used across the gateway (e.g. upstream provider errors,
 * MCP JSON-RPC error objects surfaced to callers). The type and code fields are
 * optional because some upstreams omit them.
 */
export interface ErrorEnvelope {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
}
