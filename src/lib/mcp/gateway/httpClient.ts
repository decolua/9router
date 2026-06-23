// HTTP/SSE upstream MCP client for the gateway.
//
// Generalises the existing probeMcp() helper in
// src/app/api/cli-tools/cowork-mcp-tools/route.js — the same JSON-or-SSE
// response parsing, session-header carry, and AbortController timeout — but
// turns it into a reusable request() function and adds the bits probeMcp
// deliberately omits: per-call Authorization header, pre-call `initialize`
// handshake, OAuth token auto-attach (with refresh), and a typed
// McpAuthError so the aggregator can surface 401/403 distinctly from
// generic network failure.
//
// MCP-02: Session handling now uses instance/session-safe state (global store
// keyed by instance.id) instead of shared `instance.__mcpInit`. Includes
// bounded transient retry with jitter/backoff for network blips. Sessions
// remain short-lived and are NOT persisted.

import { ensureFreshToken, oauthMetaFromTokens } from "./oauthRefresh.js";
import { retryWithBackoff } from "./retry.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpServerInfo,
  McpSessionEntry,
  InitializeResult,
  McpTool,
  ListToolsResult,
  McpAuthErrorOptions,
} from "../../../../open-sse/types/mcp.js";
import { isJsonRpcResponse } from "../../../../open-sse/types/guards.js";

const TIMEOUT_MS = 30_000; // longer than probeMcp's 8s — real tool calls may be slow
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const HTTP_SESSION_KEY = "__9routerGatewayHttpSessions";

// Local session-entry type: runtime shape uses null (not undefined) for
// uninitialized fields. McpSessionEntry (wave-1) uses optional/undefined fields
// aligned with the wave-1 spec; this local type preserves the null-initialised
// runtime shape from the original .js without altering it.
// See: McpSessionEntry in open-sse/types/mcp.ts
interface McpSessionEntryLocal {
  sessionId: string | null;        // McpSessionEntry.sessionId?: string
  protocolVersion: string | null;  // McpSessionEntry.protocolVersion: string
  serverInfo: McpServerInfo | null; // McpSessionEntry.serverInfo: McpServerInfo
  initPromise: Promise<InitializeResult> | null; // McpSessionEntry.initPromise?: Promise<InitializeResult>
}
// Structural relationship: McpSessionEntryLocal is the nullable runtime form of McpSessionEntry.
// This alias makes the import load-bearing and documents the correspondence.
type _McpSessionEntryRef = Pick<McpSessionEntry, "protocolVersion" | "serverInfo" | "initPromise">;

interface McpInstance {
  id: string;
  slug: string | undefined;
  url: string | undefined;
  oauth: boolean | undefined;
  oauthTokens: Record<string, unknown> | undefined;
  headers: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

interface McpRequestOpts {
  sessionId?: string;
  timeoutMs?: number;
  skipRetry?: boolean;
}

interface EnsureInitializedOpts {
  protocolVersion?: string;
  params?: Record<string, unknown>;
}

// Global session store: Map<instanceId, McpSessionEntryLocal>
function getSessionStore(): Map<string, McpSessionEntryLocal> {
  if (!(HTTP_SESSION_KEY in globalThis) || !(globalThis as Record<string, unknown>)[HTTP_SESSION_KEY]) {
    (globalThis as Record<string, unknown>)[HTTP_SESSION_KEY] = new Map<string, McpSessionEntryLocal>();
  }
  return (globalThis as Record<string, unknown>)[HTTP_SESSION_KEY] as Map<string, McpSessionEntryLocal>;
}

function getSessionEntry(instance: McpInstance): McpSessionEntryLocal {
  const store = getSessionStore();
  if (!store.has(instance.id)) {
    store.set(instance.id, { sessionId: null, protocolVersion: null, serverInfo: null, initPromise: null });
  }
  // noUncheckedIndexedAccess: Map.get returns T | undefined; we just set it above so assertion is safe.
  return store.get(instance.id) as McpSessionEntryLocal;
}

function clearSessionEntry(instance: McpInstance): void {
  getSessionStore().delete(instance.id);
}

export class McpAuthError extends Error {
  readonly status: number | undefined;
  readonly slug: string | undefined;
  readonly body: McpAuthErrorOptions["body"];

  constructor(message: string, { status, slug, body }: McpAuthErrorOptions = {}) {
    super(message);
    this.name = "McpAuthError";
    this.status = status;
    this.slug = slug;
    this.body = body;
  }
}

function safeParseJson(s: string): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// parseResponsePayload: returns raw parsed frames — do NOT filter here.
// isJsonRpcResponse is applied only at the frame-selection boundary in mcpRequest.
// The existing fallback (last frame or synthesized null) must remain intact.
function parseResponsePayload(res: Response, text: string): unknown[] {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    // SSE: each "data: {...}" line is a JSON-RPC message. We may receive
    // many events (notifications, etc.) — return the first one with a
    // defined `id` matching the request we sent, else the first object.
    const out: unknown[] = [];
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of dataLines) {
      const obj = safeParseJson(line.replace(/^data:\s*/, ""));
      if (obj) out.push(obj);
    }
    return out;
  }
  const parsed = safeParseJson(text);
  return parsed !== null ? [parsed] : [];
}

function readAuthFromInstance(instance: McpInstance): string | null {
  const t = instance?.oauthTokens;
  if (!t || typeof t !== "object") return null;
  if (t["needsReauth"]) return null;
  const tok = t["access_token"] ?? t["accessToken"];
  return typeof tok === "string" ? tok : null;
}

function buildHeaders(instance: McpInstance): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": DEFAULT_PROTOCOL_VERSION,
  };
  if (instance.headers && typeof instance.headers === "object") {
    for (const [k, v] of Object.entries(instance.headers)) {
      // Don't let operator headers spoof the protocol version or content type.
      const kl = k.toLowerCase();
      if (kl === "content-type" || kl === "accept" || kl.startsWith("mcp-")) continue;
      headers[k] = String(v);
    }
  }
  const token = readAuthFromInstance(instance);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * Perform an MCP JSON-RPC POST against an upstream and return the first
 * matching response frame. Throws McpAuthError on 401/403.
 * MCP-02: Adds transient retry with backoff for network failures.
 *
 * @param instance    row from mcpInstances (parsed)
 * @param jsonRpc     {jsonrpc, id, method, params}
 * @param opts        { sessionId?: string, timeoutMs?: number, skipRetry?: boolean }
 * @returns {Promise<JsonRpcResponse & { sessionId?: string | null }>}
 */
// Notifications have no `id`; requests always have one.
type McpNotification = Omit<JsonRpcRequest, "id"> & { id?: never };
type McpRpcPayload = JsonRpcRequest | McpNotification;

export async function mcpRequest<T = unknown>(
  instance: McpInstance,
  jsonRpc: McpRpcPayload,
  opts: McpRequestOpts = {},
): Promise<JsonRpcResponse<T> & { sessionId: string | null }> {
  const doRequest = async (): Promise<JsonRpcResponse<T> & { sessionId: string | null }> => {
    if (!instance?.url) {
      throw new Error(`instance ${instance?.slug ?? "?"} has no url`);
    }
    // Capture url now — OAuth reassignment below may change instance reference
    // but we guard url existence once here (pre-OAuth).
    let url: string = instance.url;
    // OAuth: refresh access token if near expiry. `ensureFreshToken` returns
    // a possibly-updated instance object — reassign so the refresh's
    // access_token is the one we use on this call.
    if (instance.oauth) {
      const meta = oauthMetaFromTokens(instance.oauthTokens as Parameters<typeof oauthMetaFromTokens>[0]);
      instance = await ensureFreshToken(instance as Parameters<typeof ensureFreshToken>[0], meta) as McpInstance;
      if (instance.oauthTokens?.["needsReauth"]) {
        throw new McpAuthError(`upstream requires re-login: ${instance.slug}`, {
          status: 401,
          ...(instance.slug !== undefined ? { slug: instance.slug } : {}),
        });
      }
      // Post-refresh: use updated url in case the instance was replaced.
      if (instance.url) url = instance.url;
    }
    const ac = new AbortController();
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers = buildHeaders(instance);
      if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(jsonRpc),
        signal: ac.signal,
      });

      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        throw new McpAuthError(`upstream ${res.status} for ${instance.slug}`, {
          status: res.status,
          ...(instance.slug !== undefined ? { slug: instance.slug } : {}),
          body: body.slice(0, 500),
        });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`upstream ${res.status} for ${instance.slug}: ${body.slice(0, 200)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }

      const text = await res.text();
      const frames = parseResponsePayload(res, text);
      const sessionId = res.headers.get("mcp-session-id") ?? opts.sessionId ?? null;

      // isJsonRpcResponse narrows at the selection boundary only — frames array
      // is kept raw so the last-frame fallback preserves existing runtime behavior.
      const reqId = "id" in jsonRpc ? jsonRpc.id : undefined;
      let frame = frames.find((f) => isJsonRpcResponse(f) && f.id === reqId) as (JsonRpcResponse<T> & { sessionId?: string }) | undefined;
      if (!frame) {
        frame = frames.find((f) => isJsonRpcResponse(f) && ("result" in f || "error" in f)) as (JsonRpcResponse<T> & { sessionId?: string }) | undefined;
      }
      if (!frame) {
        // Notifications/frames only — caller decides whether to ignore.
        const last = frames[frames.length - 1];
        frame = (last ?? { jsonrpc: "2.0", id: reqId, result: null }) as JsonRpcResponse<T> & { sessionId?: string };
      }
      return { ...frame, sessionId } as JsonRpcResponse<T> & { sessionId: string | null };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`upstream ${instance.slug} timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }; // end doRequest

  // Apply transient retry unless explicitly disabled (e.g., for notifications).
  if (opts.skipRetry) {
    return doRequest();
  }
  return retryWithBackoff(doRequest, {
    maxAttempts: 3,
    baseDelayMs: 100,
    onRetry: (err, attempt, delayMs) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[mcp-http:${instance.slug}] transient retry ${attempt + 1} after ${delayMs}ms: ${msg}`);
    },
  });
}

/**
 * Ensure the upstream has been initialized. Returns { protocolVersion, serverInfo, sessionId }.
 * MCP-02: Uses instance/session-safe state (global store) instead of shared instance.__mcpInit.
 * Single-flight: concurrent calls share the same initPromise.
 */
export async function ensureInitialized(instance: McpInstance, opts: EnsureInitializedOpts = {}): Promise<InitializeResult> {
  const entry = getSessionEntry(instance);

  // If already initialized and session still valid, return cached info.
  if (entry.sessionId && entry.protocolVersion && entry.serverInfo) {
    return {
      protocolVersion: entry.protocolVersion,
      serverInfo: entry.serverInfo,
      sessionId: entry.sessionId,
    };
  }

  // Single-flight: if initialization is in progress, return the same promise.
  if (entry.initPromise) {
    return entry.initPromise;
  }

  // Start new initialization.
  entry.initPromise = (async (): Promise<InitializeResult> => {
    try {
      const initParams = {
        protocolVersion: opts.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "9router-gateway", version: "1" },
      };
      const resp = await mcpRequest(instance, {
        jsonrpc: "2.0", id: 0, method: "initialize", params: initParams,
      });

      if ("error" in resp && resp.error !== undefined) {
        const errVal = resp.error;
        const msg = isRecord(errVal) && typeof errVal["message"] === "string" ? errVal["message"] : JSON.stringify(errVal);
        throw new Error(`initialize failed for ${instance.slug}: ${msg}`);
      }

      // Spec requires a notifications/initialized frame before any other call.
      // Some servers are lenient and accept tools/list directly. Try best-effort.
      // Skip retry for notifications since they're fire-and-forget.
      // Intentionally no `id` — this is a notification, not a request.
      await mcpRequest(instance, {
        jsonrpc: "2.0", method: "notifications/initialized", params: {},
      }, { ...(resp.sessionId ? { sessionId: resp.sessionId } : {}), timeoutMs: 5000, skipRetry: true }).catch(() => {});

      const resultVal: unknown = "result" in resp ? resp.result : null;
      const resultObj = isRecord(resultVal) ? resultVal : null;
      const serverInfoRaw = resultObj?.["serverInfo"];
      const info: InitializeResult = {
        protocolVersion: (isRecord(resultObj) && typeof resultObj["protocolVersion"] === "string" ? resultObj["protocolVersion"] : null) ?? initParams.protocolVersion,
        serverInfo: isRecord(serverInfoRaw) && typeof serverInfoRaw["name"] === "string"
          ? { name: serverInfoRaw["name"], ...(typeof serverInfoRaw["version"] === "string" ? { version: serverInfoRaw["version"] } : {}) }
          : null,
        ...(resp.sessionId ? { sessionId: resp.sessionId } : {}),
      };

      // Cache in session-safe store.
      entry.sessionId = info.sessionId ?? null;
      entry.protocolVersion = info.protocolVersion;
      entry.serverInfo = info.serverInfo;
      entry.initPromise = null; // Clear promise after successful init.

      return info;
    } catch (e) {
      // Clear entry on failure so next call retries.
      clearSessionEntry(instance);
      throw e;
    }
  })();

  return entry.initPromise;
}

export async function listTools(instance: McpInstance, opts: EnsureInitializedOpts = {}): Promise<McpTool[]> {
  const init = await ensureInitialized(instance, opts);
  const resp = await mcpRequest<ListToolsResult>(instance, {
    jsonrpc: "2.0", id: 1, method: "tools/list", params: opts.params ?? {},
  }, { ...(init.sessionId !== undefined ? { sessionId: init.sessionId } : {}) });
  if ("error" in resp && resp.error !== undefined) {
    const errVal = resp.error;
    const msg = isRecord(errVal) && typeof errVal["message"] === "string" ? errVal["message"] : JSON.stringify(errVal);
    throw new Error(`tools/list failed for ${instance.slug}: ${msg}`);
  }
  const result = "result" in resp ? resp.result : undefined;
  return result?.tools ?? [];
}

export async function callTool(
  instance: McpInstance,
  name: string,
  args: Record<string, unknown>,
  opts: EnsureInitializedOpts = {},
): Promise<unknown> {
  const init = await ensureInitialized(instance, opts);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args ?? {} },
  }, { ...(init.sessionId !== undefined ? { sessionId: init.sessionId } : {}) });
  if ("error" in resp && resp.error !== undefined) {
    const errVal = resp.error;
    const errMsg = isRecord(errVal) && typeof errVal["message"] === "string" ? errVal["message"] : `tools/call failed for ${instance.slug}`;
    const e = new Error(errMsg);
    if (isRecord(errVal) && errVal["code"] !== undefined) (e as Error & { code: unknown }).code = errVal["code"];
    if (isRecord(errVal) && errVal["data"] !== undefined) (e as Error & { data: unknown }).data = errVal["data"];
    throw e;
  }
  return "result" in resp ? resp.result : undefined;
}

export const __test__ = {
  getSessionStore,
  getSessionEntry,
  clearSessionEntry,
};

// Internal helper used above — pulled in from guards for McpServerInfo narrowing
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
