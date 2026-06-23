import type { JsonValue } from './executor.js';

// open-sse/types/mcp.ts
// Anchors: src/lib/mcp/gateway/httpClient.js
//   - McpAuthError class (lines 42-50)
//   - McpSessionEntry shape (line 24 comment)
//   - ensureInitialized (lines 196-257)
//   - listTools / callTool (lines 259-285)

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire types
// ---------------------------------------------------------------------------

/**
 * Outbound JSON-RPC 2.0 request.
 * `params` is `unknown` — narrowed to concrete shapes at call sites
 * (ensureInitialized, listTools, callTool) before passing to mcpRequest.
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  /** Boundary: caller narrows before use; raw wire value is opaque. */
  params?: unknown;
}

/**
 * Inbound JSON-RPC 2.0 response — discriminated union on `result` vs `error`.
 * Exactly one branch is present (XOR); isJsonRpcResponse in guards.ts enforces this.
 * `sessionId` is injected by mcpRequest from the mcp-session-id response header.
 */
export type JsonRpcResponse<T = JsonValue> =
  | { jsonrpc: "2.0"; id: string | number; result: T; sessionId?: string }
  | {
      jsonrpc: "2.0";
      id: string | number;
      error: { code: number; message: string; data?: JsonValue };
      sessionId?: string;
    };

// ---------------------------------------------------------------------------
// MCP server identity
// ---------------------------------------------------------------------------

/** Reported by the server during the initialize handshake. */
export interface McpServerInfo {
  name: string;
  version?: string;
}

// ---------------------------------------------------------------------------
// Session store entry (global store keyed by instanceId — httpClient.js line 24)
// ---------------------------------------------------------------------------

/**
 * Live entry in the HTTP_SESSION_KEY global store.
 * `initPromise` typed as Promise<InitializeResult>: ensureInitialized resolves to
 * { protocolVersion, serverInfo, sessionId } — the same shape as InitializeResult.
 * The single-flight guard stores and awaits this promise; its resolved value is never
 * consumed from this field directly (ensureInitialized returns it).
 */
export interface McpSessionEntry {
  sessionId?: string;
  protocolVersion: string;
  serverInfo: McpServerInfo;
  /** Single-flight guard: set while initialization is in-flight, cleared after. */
  initPromise?: Promise<InitializeResult>;
}

// ---------------------------------------------------------------------------
// MCP protocol result shapes
// ---------------------------------------------------------------------------

/**
 * Result of the `initialize` JSON-RPC method, as returned by ensureInitialized
 * (httpClient.js lines 196-257). Matches the concrete object `{ protocolVersion,
 * serverInfo, sessionId }` that the function resolves with. `serverInfo` is nullable
 * because the server may omit it (`resp.result?.serverInfo || null`). `capabilities`
 * is not consumed by this gateway layer and is omitted.
 */
export interface InitializeResult {
  protocolVersion: string;
  serverInfo: McpServerInfo | null;
  sessionId?: string;
}

/** Single tool entry as returned by `tools/list`. */
export interface McpTool {
  name: string;
  description?: string;
}

/** Result of the `tools/list` JSON-RPC method. */
export interface ListToolsResult {
  tools: McpTool[];
}

// ---------------------------------------------------------------------------
// McpAuthError — typed class matching httpClient.js lines 42-50
// ---------------------------------------------------------------------------

/**
 * Constructor options for McpAuthError, matching the destructured second arg
 * `{ status, slug, body } = {}` in httpClient.js.
 */
export interface McpAuthErrorOptions {
  status?: number;
  slug?: string;
  body?: string | JsonValue;
}

/**
 * Typed declaration of McpAuthError from httpClient.js (lines 42-50).
 * Declared as a class so `instanceof McpAuthError` checks remain valid
 * and callers can import this for typed catch branches.
 *
 * The runtime implementation lives in httpClient.js and is NOT duplicated here —
 * this declaration adds type safety to the existing class shape.
 */
export declare class McpAuthError extends Error {
  readonly name: "McpAuthError";
  readonly status?: number;
  readonly slug?: string;
  readonly body?: string | JsonValue;
  constructor(message: string, opts?: McpAuthErrorOptions);
}
