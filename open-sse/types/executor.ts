/**
 * Executor and result type definitions.
 *
 * Anchors:
 *   - createErrorResult shape: open-sse/utils/error.js (lines 98-106)
 *   - BaseExecutor.execute return: open-sse/executors/base.js (line 291)
 *   - Credentials shape: open-sse/executors/base.js buildHeaders (lines 63-93)
 *   - ProxyOptions shape: open-sse/handlers/chatCore.js (lines 313-321)
 *   - Log interface: open-sse/handlers/chatCore.js (log?.debug/info/warn usage)
 *
 * `Response` is the DOM global (tsconfig lib includes "DOM") — no import needed.
 */

// ---------------------------------------------------------------------------
// Supporting shapes derived from anchor usage in base.js + chatCore.js
// ---------------------------------------------------------------------------

/** Credentials object passed to executors. Derived from buildHeaders usage. */
export interface ExecutorCredentials {
  apiKey?: string;
  accessToken?: string;
  copilotToken?: string;
  rawHeaders?: Record<string, string>;
  connectionName?: string;
  connectionId?: string;
  providerSpecificData?: {
    baseUrl?: string;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    connectionNoProxy?: string;
    vercelRelayUrl?: string;
    connectionProxyPoolId?: string;
    [key: string]: string | boolean | undefined;
  };
}

/** Proxy options shape constructed in chatCore.js (lines 313-321). */
export interface ProxyOptions {
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
  vercelRelayUrl: string;
}

/** Minimal logger interface used by executors (log?.debug/info/warn). */
export interface ExecutorLog {
  debug?(category: string, message: string): void;
  info?(category: string, message: string): void;
  warn?(category: string, message: string): void;
}

/** Request body passed to executors — a plain JSON-serialisable object. */
export type ExecutorBody = Record<string, JsonValue>;

/** Recursive JSON value type. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Handler-level result — discriminated union on `success`
// Exact shape of createErrorResult (error.js:98-106) for the error branch.
// ---------------------------------------------------------------------------

export interface ExecutorError {
  success: false;
  /** HTTP status code */
  status: number;
  /** Error message string */
  error: string;
  /** Optional precise cooldown expiry (ms epoch) for provider quota errors */
  resetsAtMs?: number;
  /** Ready-to-send error Response */
  response: Response;
}

export interface ExecutorSuccess {
  success: true;
  /** HTTP status code */
  status: number;
  /** Upstream Response (streaming or non-streaming) */
  response: Response;
}

/** Discriminated union on `success` — use to narrow handler-level results. */
export type ExecutorResult = ExecutorSuccess | ExecutorError;

// ---------------------------------------------------------------------------
// Raw fetch result — shape returned by BaseExecutor.execute (base.js:291)
// Distinct from ExecutorResult; this is the upstream fetch shape consumed
// directly by chatCore and streaming handlers (result.response / result.url).
// ---------------------------------------------------------------------------

export interface ExecutorFetchResult {
  /** The raw upstream Response */
  response: Response;
  /** The URL that was actually fetched */
  url: string;
  /** Headers sent to the upstream */
  headers: Record<string, string>;
  /** Request body after transformRequest() was applied */
  transformedBody: ExecutorBody;
}

// ---------------------------------------------------------------------------
// Executor interface — contract of BaseExecutor and all subclasses
// Public method surface from base.js.
// ---------------------------------------------------------------------------

export interface Executor {
  getProvider(): string;
  getBaseUrls(): string[];
  getFallbackCount(): number;
  buildUrl(
    model: string,
    stream: boolean,
    urlIndex?: number,
    credentials?: ExecutorCredentials | null,
  ): string;
  buildHeaders(
    credentials: ExecutorCredentials,
    stream?: boolean,
  ): Record<string, string>;
  transformRequest(
    model: string,
    body: ExecutorBody,
    stream: boolean,
    credentials: ExecutorCredentials,
  ): ExecutorBody;
  shouldRetry(status: number, urlIndex: number): boolean;
  refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLog,
    proxyOptions?: ProxyOptions | null,
  ): Promise<Partial<ExecutorCredentials> | null>;
  needsRefresh(credentials: ExecutorCredentials): boolean;
  parseError(
    response: Response,
    bodyText: string,
  ): { status: number; message: string };
  execute(params: {
    model: string;
    body: ExecutorBody;
    stream: boolean;
    credentials: ExecutorCredentials;
    signal?: AbortSignal;
    log?: ExecutorLog;
    proxyOptions?: ProxyOptions | null;
  }): Promise<ExecutorFetchResult>;
}
