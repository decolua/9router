// HTTP/SSE upstream MCP client for the gateway.

import { ensureFreshToken, oauthMetaFromTokens } from "./oauthRefresh";
import { retryWithBackoff } from "./retry";
import { isJsonRpcResponse, isRecord } from "./guards";

const TIMEOUT_MS = 30_000;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const HTTP_SESSION_KEY = "__9routerGatewayHttpSessions";

function getSessionStore() {
  if (!globalThis[HTTP_SESSION_KEY]) {
    globalThis[HTTP_SESSION_KEY] = new Map();
  }
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
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const out = [];
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

function readAuthFromInstance(instance) {
  const t = instance?.oauthTokens;
  if (!t || typeof t !== "object") return null;
  if (t.needsReauth) return null;
  const tok = t.access_token ?? t.accessToken;
  return typeof tok === "string" ? tok : null;
}

function buildHeaders(instance) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": DEFAULT_PROTOCOL_VERSION,
  };
  if (instance.headers && typeof instance.headers === "object") {
    for (const [k, v] of Object.entries(instance.headers)) {
      const kl = k.toLowerCase();
      if (kl === "content-type" || kl === "accept" || kl.startsWith("mcp-")) continue;
      headers[k] = String(v);
    }
  }
  const token = readAuthFromInstance(instance);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Perform an MCP JSON-RPC POST against an upstream and return the first
 * matching response frame. Throws McpAuthError on 401/403.
 *
 * @param {object} instance   parsed mcpInstances row
 * @param {object} jsonRpc    {jsonrpc, id, method, params}
 * @param {object} [opts]     {sessionId, timeoutMs, skipRetry}
 * @returns {Promise<object>} JSON-RPC response with injected sessionId
 */
export async function mcpRequest(instance, jsonRpc, opts = {}) {
  const doRequest = async () => {
    if (!instance?.url) {
      throw new Error(`instance ${instance?.slug ?? "?"} has no url`);
    }

    let currentInstance = instance;
    let url = currentInstance.url;

    if (currentInstance.oauth) {
      const meta = oauthMetaFromTokens(currentInstance.oauthTokens);
      currentInstance = await ensureFreshToken(currentInstance, meta);
      if (currentInstance.oauthTokens?.needsReauth) {
        throw new McpAuthError(`upstream requires re-login: ${currentInstance.slug}`, {
          status: 401,
          ...(currentInstance.slug !== undefined ? { slug: currentInstance.slug } : {}),
        });
      }
      if (currentInstance.url) url = currentInstance.url;
    }

    const ac = new AbortController();
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const headers = buildHeaders(currentInstance);
      if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(jsonRpc),
        signal: ac.signal,
      });

      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        throw new McpAuthError(`upstream ${res.status} for ${currentInstance.slug}`, {
          status: res.status,
          ...(currentInstance.slug !== undefined ? { slug: currentInstance.slug } : {}),
          body: body.slice(0, 500),
        });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`upstream ${res.status} for ${currentInstance.slug}: ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }

      const text = await res.text();
      const frames = parseResponsePayload(res, text);
      const sessionId = res.headers.get("mcp-session-id") ?? opts.sessionId ?? null;

      const reqId = "id" in jsonRpc ? jsonRpc.id : undefined;
      let frame = frames.find((f) => isJsonRpcResponse(f) && f.id === reqId);
      if (!frame) {
        frame = frames.find((f) => isJsonRpcResponse(f) && ("result" in f || "error" in f));
      }
      if (!frame) {
        const last = frames[frames.length - 1];
        frame = last ?? { jsonrpc: "2.0", id: reqId, result: null };
      }
      return { ...frame, sessionId };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`upstream ${currentInstance.slug} timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

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
 * Ensure the upstream has been initialized.
 * @param {object} instance
 * @param {object} [opts]
 * @returns {Promise<{protocolVersion: string, serverInfo: object | null, sessionId?: string}>}
 */
export async function ensureInitialized(instance, opts = {}) {
  const entry = getSessionEntry(instance);

  if (entry.sessionId && entry.protocolVersion && entry.serverInfo) {
    return {
      protocolVersion: entry.protocolVersion,
      serverInfo: entry.serverInfo,
      sessionId: entry.sessionId,
    };
  }

  if (entry.initPromise) {
    return entry.initPromise;
  }

  entry.initPromise = (async () => {
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
        const msg = isRecord(errVal) && typeof errVal.message === "string" ? errVal.message : JSON.stringify(errVal);
        throw new Error(`initialize failed for ${instance.slug}: ${msg}`);
      }

      await mcpRequest(instance, {
        jsonrpc: "2.0", method: "notifications/initialized", params: {},
      }, { ...(resp.sessionId ? { sessionId: resp.sessionId } : {}), timeoutMs: 5000, skipRetry: true }).catch(() => {});

      const resultVal = "result" in resp ? resp.result : null;
      const resultObj = isRecord(resultVal) ? resultVal : null;
      const serverInfoRaw = resultObj?.serverInfo;
      const info = {
        protocolVersion: (isRecord(resultObj) && typeof resultObj.protocolVersion === "string" ? resultObj.protocolVersion : null) ?? initParams.protocolVersion,
        serverInfo: isRecord(serverInfoRaw) && typeof serverInfoRaw.name === "string"
          ? { name: serverInfoRaw.name, ...(typeof serverInfoRaw.version === "string" ? { version: serverInfoRaw.version } : {}) }
          : null,
        ...(resp.sessionId ? { sessionId: resp.sessionId } : {}),
      };

      entry.sessionId = info.sessionId ?? null;
      entry.protocolVersion = info.protocolVersion;
      entry.serverInfo = info.serverInfo;
      entry.initPromise = null;

      return info;
    } catch (e) {
      clearSessionEntry(instance);
      throw e;
    }
  })();

  return entry.initPromise;
}

export async function listTools(instance, opts = {}) {
  const init = await ensureInitialized(instance, opts);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0", id: 1, method: "tools/list", params: opts.params ?? {},
  }, { ...(init.sessionId !== undefined ? { sessionId: init.sessionId } : {}) });
  if ("error" in resp && resp.error !== undefined) {
    const errVal = resp.error;
    const msg = isRecord(errVal) && typeof errVal.message === "string" ? errVal.message : JSON.stringify(errVal);
    throw new Error(`tools/list failed for ${instance.slug}: ${msg}`);
  }
  const result = "result" in resp ? resp.result : undefined;
  return result?.tools ?? [];
}

export async function callTool(instance, name, args, opts = {}) {
  const init = await ensureInitialized(instance, opts);
  const resp = await mcpRequest(instance, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args ?? {} },
  }, { ...(init.sessionId !== undefined ? { sessionId: init.sessionId } : {}) });
  if ("error" in resp && resp.error !== undefined) {
    const errVal = resp.error;
    const errMsg = isRecord(errVal) && typeof errVal.message === "string" ? errVal.message : `tools/call failed for ${instance.slug}`;
    const e = new Error(errMsg);
    if (isRecord(errVal) && errVal.code !== undefined) e.code = errVal.code;
    if (isRecord(errVal) && errVal.data !== undefined) e.data = errVal.data;
    throw e;
  }
  return "result" in resp ? resp.result : undefined;
}

export const __test__ = {
  getSessionStore,
  getSessionEntry,
  clearSessionEntry,
};
