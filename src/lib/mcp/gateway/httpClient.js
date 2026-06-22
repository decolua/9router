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

const TIMEOUT_MS = 30_000; // longer than probeMcp's 8s — real tool calls may be slow
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const HTTP_SESSION_KEY = "__9routerGatewayHttpSessions";

// Global session store: Map<instanceId, { sessionId, protocolVersion, serverInfo, initPromise }>
function getSessionStore() {
  if (!globalThis[HTTP_SESSION_KEY]) globalThis[HTTP_SESSION_KEY] = new Map();
  return globalThis[HTTP_SESSION_KEY];
}

function getSessionEntry(instance) {
  const store = getSessionStore();
  if (!store.has(instance.id)) {
    store.set(instance.id, { sessionId: null, protocolVersion: null, serverInfo: null, initPromise: null });
  }
  return store.get(instance.id);
}

function clearSessionEntry(instance) {
  getSessionStore().delete(instance.id);
}

export class McpAuthError extends Error {
  constructor(message, { status, slug, body } = {}) {
    super(message);
    this.name = "McpAuthError";
    this.status = status;
    this.slug = slug;
    this.body = body;
  }
}

function safeParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function parseResponsePayload(res, text) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    // SSE: each "data: {...}" line is a JSON-RPC message. We may receive
    // many events (notifications, etc.) — return the first one with a
    // defined `id` matching the request we sent, else the first object.
    const out = [];
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of dataLines) {
      const obj = safeParseJson(line.replace(/^data:\s*/, ""));
      if (obj) out.push(obj);
    }
    return out;
  }
  return [safeParseJson(text)].filter(Boolean);
}

function readAuthFromInstance(instance) {
  const t = instance?.oauthTokens;
  if (!t || typeof t !== "object") return null;
  if (t.needsReauth) return null;
  return t.access_token || t.accessToken || null;
}

function buildHeaders(instance) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": DEFAULT_PROTOCOL_VERSION,
  };
  if (instance.headers && typeof instance.headers === "object") {
    for (const [k, v] of Object.entries(instance.headers)) {
      // Don't let operator headers spoof the protocol version or content type.
      if (k.toLowerCase() === "content-type" || k.toLowerCase() === "accept" || k.toLowerCase().startsWith("mcp-")) continue;
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
 * @param {object} instance    row from mcpInstances (parsed)
 * @param {object} jsonRpc     {jsonrpc, id, method, params}
 * @param {object} [opts]      { sessionId?: string, timeoutMs?: number, skipRetry?: boolean }
 * @returns {Promise<{ result?: any, error?: any, sessionId?: string }>}
 */
export async function mcpRequest(instance, jsonRpc, opts = {}) {
  const doRequest = async () => {
  if (!instance?.url) {
    throw new Error(`instance ${instance?.slug || "?"} has no url`);
  }
  // OAuth: refresh access token if near expiry. `ensureFreshToken` returns
  // a possibly-updated instance object — reassign so the refresh's
  // access_token is the one we use on this call.
  if (instance.oauth) {
    const meta = oauthMetaFromTokens(instance.oauthTokens);
    instance = await ensureFreshToken(instance, meta);
    if (instance.oauthTokens?.needsReauth) {
      throw new McpAuthError(`upstream requires re-login: ${instance.slug}`, {
        status: 401,
        slug: instance.slug,
      });
    }
  }
  const ac = new AbortController();
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = buildHeaders(instance);
    if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;

    const res = await fetch(instance.url, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonRpc),
      signal: ac.signal,
    });

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      throw new McpAuthError(`upstream ${res.status} for ${instance.slug}`, {
        status: res.status,
        slug: instance.slug,
        body: body?.slice(0, 500),
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`upstream ${res.status} for ${instance.slug}: ${body?.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const text = await res.text();
    const frames = parseResponsePayload(res, text);
    const sessionId = res.headers.get("mcp-session-id") || opts.sessionId || null;

    // Find the frame whose `id` matches our request; else the first with a result/error.
    let frame = frames.find((f) => f && f.id === jsonRpc.id);
    if (!frame) frame = frames.find((f) => f && (f.result !== undefined || f.error !== undefined));
    if (!frame) {
      // Notifications/frames only — caller decides whether to ignore.
      frame = frames[frames.length - 1] || { jsonrpc: "2.0", id: jsonRpc.id, result: null };
    }
    return { ...frame, sessionId };
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`upstream ${instance.slug} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  }; // end doRequest

  // Apply transient retry unless explicitly disabled (e.g., for notifications).
  if (opts.skipRetry) {
    return await doRequest();
  }
  return await retryWithBackoff(doRequest, {
    maxAttempts: 3,
    baseDelayMs: 100,
    onRetry: (err, attempt, delayMs) => {
      console.log(`[mcp-http:${instance.slug}] transient retry ${attempt + 1} after ${delayMs}ms: ${err.message}`);
    },
  });
}

/**
 * Ensure the upstream has been initialized. Returns { protocolVersion, serverInfo, sessionId }.
 * MCP-02: Uses instance/session-safe state (global store) instead of shared instance.__mcpInit.
 * Single-flight: concurrent calls share the same initPromise.
 */
export async function ensureInitialized(instance, opts = {}) {
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
  entry.initPromise = (async () => {
    try {
      const initParams = {
        protocolVersion: opts.protocolVersion || DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "9router-gateway", version: "1" },
      };
      const resp = await mcpRequest(instance, {
        jsonrpc: "2.0", id: 0, method: "initialize", params: initParams,
      });
      
      if (resp.error) {
        throw new Error(`initialize failed for ${instance.slug}: ${resp.error.message || JSON.stringify(resp.error)}`);
      }
      
      // Spec requires a notifications/initialized frame before any other call.
      // Some servers are lenient and accept tools/list directly. Try best-effort.
      // Skip retry for notifications since they're fire-and-forget.
      await mcpRequest(instance, {
        jsonrpc: "2.0", method: "notifications/initialized", params: {},
      }, { sessionId: resp.sessionId, timeoutMs: 5000, skipRetry: true }).catch(() => {});

      const info = {
        protocolVersion: resp.result?.protocolVersion || initParams.protocolVersion,
        serverInfo: resp.result?.serverInfo || null,
        sessionId: resp.sessionId,
      };
      
      // Cache in session-safe store.
      entry.sessionId = info.sessionId;
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

export async function listTools(instance, opts = {}) {
  const init = await ensureInitialized(instance, opts);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0", id: 1, method: "tools/list", params: opts.params || {},
  }, { sessionId: init.sessionId });
  if (resp.error) {
    throw new Error(`tools/list failed for ${instance.slug}: ${resp.error.message || JSON.stringify(resp.error)}`);
  }
  return resp.result?.tools || [];
}

export async function callTool(instance, name, args, opts = {}) {
  const init = await ensureInitialized(instance, opts);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args || {} },
  }, { sessionId: init.sessionId });
  if (resp.error) {
    const e = new Error(resp.error.message || `tools/call failed for ${instance.slug}`);
    e.code = resp.error.code;
    e.data = resp.error.data;
    throw e;
  }
  return resp.result;
}

export const __test__ = {
  getSessionStore,
  getSessionEntry,
  clearSessionEntry,
};

