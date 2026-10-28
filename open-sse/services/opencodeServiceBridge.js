export function createOpencodeRateLimitError(rawMessage = "") {
  const cleanMsg = "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go";
  const error = new Error(cleanMsg);
  error.status = 429;
  error.statusCode = 429;
  error.code = "rate_limit_exceeded";
  error.type = "rate_limit_error";
  error.isOpenCodeServiceError = true;
  error.rawCause = String(rawMessage || "");
  return error;
}

export function notifyDaemonRateLimit(daemonUrl, rawMessage) {
  dbg("OPENCODE_SVC", `Intercepted daemon 429 quota exhaustion: ${String(rawMessage).slice(0, 200)}`);
  daemonSessionCache.clear();
  for (const [key, session] of serviceSessionPool.entries()) {
    if (!daemonUrl || session?.service?.url === daemonUrl) {
      serviceSessionPool.delete(key);
      if (session.activeTurn) {
        session.activeTurn.queue.push({
          type: "rate_limit",
          message: rawMessage,
        });
      }
      session.close();
    }
  }
}

import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { dbg } from "../utils/debugLog.js";

const DEFAULT_STATE_PATH = path.join(os.homedir(), ".local", "state", "opencode", "service.json");

// Cache of on-demand daemon processes per proxy URL
const proxyDaemonPool = new Map();
const DAEMON_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes idle reaper

function isDaemonBusy(info) {
  for (const session of serviceSessionPool.values()) {
    if (session?.service?.url === info.url && !session.closed) {
      if (session.activeTurn || session.pendingCalls.size > 0 || session.queuedCalls.length > 0) {
        return true;
      }
    }
  }
  return false;
}

function scheduleDaemonReaper(poolKey, info) {
  if (info.reaperTimer) clearTimeout(info.reaperTimer);
  info.reaperTimer = setTimeout(() => {
    if (isDaemonBusy(info)) {
      dbg("OPENCODE_SVC", `Daemon ${poolKey} is currently busy with active turns; postponing reaper`);
      scheduleDaemonReaper(poolKey, info);
      return;
    }
    dbg("OPENCODE_SVC", `Reaping idle on-demand daemon for ${poolKey}`);
    try { info.process?.kill?.(); } catch {}
    proxyDaemonPool.delete(poolKey);
    // Close and evict all active sessions attached to this reaped daemon
    for (const [key, session] of serviceSessionPool) {
      if (session?.service?.url === info.url) {
        session.close();
        serviceSessionPool.delete(key);
      }
    }
  }, DAEMON_IDLE_TIMEOUT_MS);
}

export function touchDaemonActivity(poolKey) {
  const info = proxyDaemonPool.get(poolKey);
  if (info) scheduleDaemonReaper(poolKey, info);
}

// Ensure all child daemon processes terminate when 9Router server exits
if (typeof process !== "undefined" && !globalThis._opencodeCleanupRegistered) {
  globalThis._opencodeCleanupRegistered = true;
  const cleanupAllDaemons = () => {
    for (const [key, info] of proxyDaemonPool) {
      try { info.process?.kill?.(); } catch {}
    }
    proxyDaemonPool.clear();
  };
  process.on("exit", cleanupAllDaemons);
  process.on("SIGINT", cleanupAllDaemons);
  process.on("SIGTERM", cleanupAllDaemons);
}
// Persistent OpenCode sessions own one event subscriber and one client-MCP
// socket. The HTTP request from the downstream agent is intentionally shorter
// lived: a pending MCP tools/call may outlive the request until its tool result
// arrives on the next turn.
const serviceSessionPool = new Map();
const MAX_SERVICE_SESSIONS = 100;
const MAX_SESSION_TURNS = 8;


const MCP_PROTOCOL_VERSION = "2025-11-25";
const SERVICE_TURN_TIMEOUT_MS = 300_000; // 5 minutes turn allowance for large contexts
const SERVICE_TOOL_TIMEOUT_MS = 360_000; // 6 minutes tool execution allowance
const SERVICE_EVENT_CONNECT_TIMEOUT_MS = 5_000;
const SERVICE_RECONNECT_DELAY_MS = 500;
const SERVICE_ORCHESTRATOR_TOOL = "execute";

const DIAGNOSTIC_EVENT_TYPES = new Set([
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "permission.asked",
  "permission.replied",
]);

export function createServiceTurnWatchdog({ timeoutMs = SERVICE_TURN_TIMEOUT_MS, onTimeout }) {
  let timer = null;
  let expired = false;

  const reset = (nextTimeoutMs = timeoutMs) => {
    if (timer) clearTimeout(timer);
    expired = false;
    timer = setTimeout(() => {
      if (expired) return;
      expired = true;
      onTimeout?.(nextTimeoutMs);
    }, Math.max(0, nextTimeoutMs));
  };

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { reset, clear };
}

function serviceAuthHeader(password) {
  return "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
}

function resolveOpenCodeServiceApiKey(credentials) {
  const apiKey = credentials?.apiKey
    || credentials?.accessToken
    || credentials?.providerSpecificData?.apiKey;
  if (!apiKey || apiKey === "public" || apiKey === "Bearer public") return "public";
  return apiKey;
}

function normalizeServiceNoProxy(value) {
  const entries = String(value || "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([...entries, "localhost", "127.0.0.1", "::1"])].join(",");
}

function displayProxyUrl(proxyUrl) {
  if (!proxyUrl) return "direct";
  try {
    const parsed = new URL(proxyUrl);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}`;
  } catch {
    return "configured";
  }
}

function sanitizeServiceProcessLog(line) {
  return String(line || "")
    .replace(/(authorization\s*[:=]\s*)([^\s,}]+)/ig, "$1<redacted>")
    .replace(/(bearer\s+)[^\s,}]+/ig, "$1<redacted>")
    .replace(/(https?:\/\/)([^/\s:@]+):([^@\s]+)@/ig, "$1<redacted>@");
}

function isUsefulServiceProcessLog(line) {
  return /freeusagelimit|free usage limit|inference|provider|model|proxy|429|403|401|error|failed|timeout/i.test(line)
    && !/messages|prompt|content/i.test(line);
}

export function buildOpenCodeServiceEnv({ baseEnv = process.env, proxyUrl = "", noProxy = "", apiKey } = {}) {
  const normalizedNoProxy = normalizeServiceNoProxy(noProxy);
  const env = {
    ...baseEnv,
    NO_PROXY: normalizedNoProxy,
    no_proxy: normalizedNoProxy,
  };
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
  }
  if (apiKey !== undefined) env.OPENCODE_API_KEY = apiKey;
  if (env.NODE_ENV !== "production") env.OPENCODE_LOG_LEVEL = "DEBUG";
  return env;
}

function normalizeToolDefinition(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return null;
  const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
    ? tool.function
    : tool;
  const name = typeof fn.name === "string" ? fn.name.trim() : "";
  if (!name) return null;
  const schema = fn.parameters || fn.input_schema || fn.inputSchema;
  const parameters = schema && typeof schema === "object" && !Array.isArray(schema)
    ? schema
    : { type: "object", properties: {} };
  return {
    name,
    description: typeof fn.description === "string" ? fn.description : "",
    inputSchema: parameters,
  };
}

function normalizeMcpTools(tools) {
  if (!Array.isArray(tools)) return [];
  const seen = new Set();
  const result = [];
  for (const tool of tools) {
    const normalized = normalizeToolDefinition(tool);
    if (!normalized || seen.has(normalized.name)) continue;
    seen.add(normalized.name);
    result.push(normalized);
  }
  return result;
}

export function serviceBridgePermissions(relayName, tools) {
  const normalized = normalizeMcpTools(tools);
  // Do NOT send global deny-all permissions on session creation, as it strips
  // OpenCode's required fingerprint tools (read, shell) from the upstream model request,
  // triggering Cloudflare's 429 FreeUsageLimitError.
  // Local tool execution is safely guarded at runtime by event-interception instead.
  const permissions = [];
  if (normalized.length > 0) {
    permissions.push(
      { action: SERVICE_ORCHESTRATOR_TOOL, resource: "*", effect: "allow" },
      { action: `${relayName}_*`, resource: "*", effect: "allow" },
    );
  }
  return permissions;
}

export function isServiceBridgeToolAllowed(toolName, { relayName, tools = [] } = {}) {
  if (!toolName || typeof toolName !== "string") return false;
  const normalized = normalizeMcpTools(tools);
  if (toolName === SERVICE_ORCHESTRATOR_TOOL) return normalized.length > 0;
  if (normalized.some((tool) => tool.name === toolName)) return true;
  return Boolean(relayName && normalized.some((tool) => `${relayName}_${tool.name}` === toolName));
}

const BRIDGE_FORBIDDEN_CODE_PATTERNS = [
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
  /\b(?:process\s*\.|globalThis|global\s*\.|require\s*\(|import\s*\(|Bun\.|Deno\.)/i,
  /\b(?:fs|child_process|worker_threads|net|https?)\s*\./i,
  /\b(?:eval\s*\(|new\s+Function\b|setTimeout\s*\(|setInterval\s*\(|setImmediate\s*\()/i,
];

function stripCodeStringLiterals(code) {
  if (typeof code !== "string" || !code) return "";
  // Strip string literals (backticks, double quotes, single quotes) so that
  // arguments (e.g. bash commands containing 'function', 'process', or URLs)
  // are not falsely matched as dangerous JS execution patterns.
  return code.replace(/(`[\s\S]*?`|"(?:\\.|[^"\\])*"|'(?:\\.|[^\'\\])*')/g, '""');
}

export function isBridgeOnlyOrchestratorInput(input, relayName) {
  const code = typeof input?.code === "string" ? input.code : "";
  if (!code) return true;
  const executableCode = stripCodeStringLiterals(code);
  if (BRIDGE_FORBIDDEN_CODE_PATTERNS.some((pattern) => pattern.test(executableCode))) return false;
  // Model may call current relay name or previous turn's relay name (e.g. tools["ninerouter_..."] or tools.xxx)
  // as history accumulates across multiple turns. Accept any ninerouter MCP relay namespace or generic tools access.
  const hasRelayCall = !relayName
    || code.includes(relayName)
    || /\btools\[["']ninerouter_[a-zA-Z0-9_-]+["']\]/i.test(code)
    || /\btools\.ninerouter_/i.test(code);
  return code.includes("tools") && hasRelayCall;
}

function serviceRelayName(cacheKey, directory = "") {
  // Isolate by connection and directory so different tabs and projects have isolated MCP controllers,
  // but keep the relay name stable across turns and session recyclings within the same workspace!
  const conn = String(cacheKey || "").split(":")[0] || "default";
  const dirKey = directory || (String(cacheKey || "").match(/:dir:([a-zA-Z0-9_-]+)/) || [])[1] || "default";
  return `ninerouter_${crypto.createHash("sha256").update(`${conn}:${dirKey}`).digest("hex").slice(0, 16)}`;
}

function serializeToolResult(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (part?.text && typeof part.text === "string") return part.text;
      try { return JSON.stringify(part); } catch { return String(part); }
    }).join("\n");
  }
  if (content === undefined || content === null) return "";
  try { return JSON.stringify(content); } catch { return String(content); }
}

function toolResultCandidates(messages) {
  if (!Array.isArray(messages)) return [];
  const results = [];
  for (const message of messages) {
    const toolId = message?.tool_call_id || message?.call_id || (message?.role === "tool" ? message?.id : null);
    if (message?.role === "tool" && toolId) {
      results.push({
        id: toolId,
        name: message.name || null,
        content: message.content,
        isError: message.is_error === true || message.status === "error",
      });
    }
    if (message?.type === "function_call_output" && (message.call_id || message.id || message.tool_call_id)) {
      results.push({
        id: message.call_id || message.id || message.tool_call_id,
        name: message.name || null,
        content: message.output,
        isError: message.is_error === true || message.status === "error",
      });
    }
    if (message?.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type !== "tool_result" || !(part.tool_use_id || part.tool_call_id || part.id)) continue;
        results.push({
          id: part.tool_use_id || part.tool_call_id || part.id,
          name: part.name || null,
          content: part.content,
          isError: part.is_error === true || part.status === "error",
        });
      }
    }
  }
  return results;
}

function messageFingerprint(message) {
  try { return JSON.stringify(message); } catch { return String(message); }
}

function serviceExecutionError(event) {
  const message = event?.data?.error?.message
    || event?.data?.error?.error?.message
    || (event?.data?.reason ? `OpenCode service execution interrupted (${event.data.reason})` : "OpenCode service execution failed");
  const status = Number(event?.data?.error?.status)
    || (/free usage limit|free tier|subscribe to opencode go|failed to drain session/i.test(message) ? 429 : 500);
  const error = new Error(message);
  error.status = status;
  error.isOpenCodeServiceError = true;
  return error;
}

class ServiceTurnQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
    this.closeError = null;
  }

  push(item) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(item);
    else this.items.push(item);
  }

  close(error = null) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    for (const waiter of this.waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve({ type: "closed" });
    }
  }

  async next() {
    if (this.items.length > 0) return this.items.shift();
    if (this.closed) {
      if (this.closeError) throw this.closeError;
      return { type: "closed" };
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async nextWithTimeout(timeoutMs) {
    if (this.items.length > 0) return this.items.shift();
    if (this.closed) {
      if (this.closeError) throw this.closeError;
      return { type: "closed" };
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve: null, reject: null };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(null);
      }, Math.max(0, timeoutMs));
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      waiter.reject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.waiters.push(waiter);
    });
  }

  drainToolCalls() {
    const calls = [];
    this.items = this.items.filter((item) => {
      if (item?.type === "tool_call") {
        calls.push(item.call);
        return false;
      }
      return true;
    });
    return calls;
  }
}

class OpenCodeClientMcpRelay {
  constructor({ service, name, directory, onToolCall }) {
    this.service = service;
    this.name = name;
    this.directory = directory;
    this.onToolCall = onToolCall;
    this.socket = null;
    this.tools = [];
    this.closed = false;
    this.disposed = false;
    this.openPromise = null;
    this.reconnectTimer = null;
    this.reconnectDelay = SERVICE_RECONNECT_DELAY_MS;
  }

  async connect() {
    if (this.disposed) throw new Error("OpenCode MCP relay is closed");
    if (this.openPromise) return this.openPromise;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openPromise = (async () => {
      const nativeDynamicImport = new Function("s", "return import(s)");
      const wsModule = await nativeDynamicImport("ws");
      const WebSocketImpl = wsModule.WebSocket || wsModule.default;
      if (!WebSocketImpl) throw new Error("OpenCode MCP relay requires the ws package");

      const wsUrl = new URL(`${this.service.url.replace(/^http/, "ws")}/api/experimental/client-mcp`);
      wsUrl.searchParams.set("name", this.name);
      wsUrl.searchParams.set("location[directory]", this.directory);
      const socket = new WebSocketImpl(wsUrl, {
        headers: { Authorization: serviceAuthHeader(this.service.password) },
      });
      this.socket = socket;

      await new Promise((resolve, reject) => {
        const onOpen = () => { cleanup(); resolve(); };
        const onError = (error) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); };
        const cleanup = () => {
          socket.off?.("open", onOpen);
          socket.off?.("error", onError);
        };
        socket.once("open", onOpen);
        socket.once("error", onError);
      });

      this.closed = false;
      this.reconnectDelay = SERVICE_RECONNECT_DELAY_MS;

      socket.on("message", (data) => {
        void this.handleMessage(data);
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
        this.closed = true;
        this.openPromise = null;
        if (!this.disposed && !this.reconnectTimer) {
          const delay = this.reconnectDelay;
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch((error) => {
              dbg("OPENCODE_MCP", `Relay ${this.name} reconnect failed: ${error?.message || error}`);
            });
          }, delay);
        }
      });
      socket.on("error", (error) => {
        dbg("OPENCODE_MCP", `Relay ${this.name} socket error: ${error?.message || error}`);
      });
    })();
    try {
      await this.openPromise;
    } catch (error) {
      this.openPromise = null;
      throw error;
    }
  }

  setTools(tools) {
    const nextTools = normalizeMcpTools(tools);
    const changed = JSON.stringify(this.tools) !== JSON.stringify(nextTools);
    this.tools = nextTools;
    if (changed && this.socket && !this.closed && this.socket.readyState === 1) {
      try {
        this.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      } catch {}
    }
  }

  send(payload) {
    if (!this.socket || this.closed || this.socket.readyState !== 1) {
      throw new Error("OpenCode MCP relay socket is not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  async handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    } catch {
      return;
    }
    if (message?.method === "initialize") {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "9router-mcp-relay", version: "1.0.0" },
        },
      });
      return;
    }
    if (message?.method === "notifications/initialized") return;
    if (message?.method === "ping") {
      this.send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    if (message?.method === "tools/list") {
      this.send({ jsonrpc: "2.0", id: message.id, result: { tools: this.tools } });
      return;
    }
    if (message?.method === "tools/call") {
      const toolName = typeof message.params?.name === "string" ? message.params.name : "";
      if (!toolName) {
        this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Missing MCP tool name" } });
        return;
      }
      const tool = this.tools.find((entry) => entry.name === toolName);
      if (!tool) {
        this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unknown MCP tool: ${toolName}` } });
        return;
      }
      try {
        await this.onToolCall({
          rpcId: message.id,
          name: toolName,
          arguments: message.params?.arguments && typeof message.params.arguments === "object"
            ? message.params.arguments
            : {},
          sessionId: message.params?._meta?.["ai.opencode/sessionID"] || null,
          relay: this,
        });
      } catch (error) {
        this.send({ jsonrpc: "2.0", id: message.id, result: {
          isError: true,
          content: [{ type: "text", text: error?.message || String(error) }],
        } });
      }
    }
  }

  respond(rpcId, content, isError = false) {
    this.send({
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        isError,
        content: [{ type: "text", text: serializeToolResult(content) }],
      },
    });
  }

  close(immediate = false) {
    this.disposed = true;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const sock = this.socket;
    this.socket = null;
    this.openPromise = null;
    if (immediate) {
      try { sock?.close?.(); } catch {}
    } else if (sock) {
      // Graceful drain period (30s) so pending JSON-RPC invocations from OpenCode CLI
      // complete cleanly instead of throwing "Connection closed" or timing out.
      setTimeout(() => {
        try { sock.close?.(); } catch {}
      }, 30_000);
    }
  }
}

class OpenCodeServiceSession {
  constructor({ service, sessionId, model, directory, cacheKey }) {
    this.service = service;
    this.sessionId = sessionId;
    this.model = model;
    this.directory = directory;
    this.cacheKey = cacheKey;
    this.auth = serviceAuthHeader(service.password);
    this.closed = false;
    this.eventsStarted = false;
    this.eventReadyPromise = null;
    this.eventReadyResolve = null;
    this.eventReadyReject = null;
    this.eventReadySettled = false;
    this.eventReadyTimer = null;
    this.eventAbort = new AbortController();
    this.activeTurn = null;
    this.pendingCalls = new Map();
    this.queuedCalls = [];
    this.seenUserMessages = new Map();
    this.hasPrompt = false;
    this.relay = null;
    this.relayName = serviceRelayName(cacheKey, directory);
    this.relayToolsFingerprint = "";
    this.lastEventType = null;
    this.lastEventAt = 0;
    this.repliedPermissionIds = new Set();
    this.toolNamesById = new Map();
    this.allowedMcpToolNames = new Set();
    this.permissionsFingerprint = "";
    this.turnCount = 0;
    this.lastContextLength = 0;
  }

  async initialize(tools) {
    await this.ensureRelay(tools);
    // Do NOT send PATCH permissions: OpenCode CLI strips 'read' and 'shell' when
    // session permissions are restricted, triggering Cloudflare's 429 FreeUsageLimitError.
    // Host safety is 100% enforced by runtime event interception (session.tool.called).
    await this.startEvents();
    return this;
  }

  async ensureRelay(tools) {
    const normalized = normalizeMcpTools(tools);
    this.allowedMcpToolNames = new Set(normalized.map((tool) => tool.name));
    if (normalized.length === 0) {
      this.relay?.close();
      this.relay = null;
      this.relayToolsFingerprint = "";
      return;
    }
    const fingerprint = JSON.stringify(normalized);
    if (this.relay && !this.relay.disposed) {
      this.relay.setTools(normalized);
      this.relayToolsFingerprint = fingerprint;
      if (this.relay.closed) await this.relay.connect();
      return;
    }
    this.relay?.close();
    this.relay = new OpenCodeClientMcpRelay({
      service: this.service,
      name: this.relayName,
      directory: this.directory,
      onToolCall: (call) => this.handleMcpToolCall(call),
    });
    this.relay.setTools(normalized);
    await this.relay.connect();
    this.relayToolsFingerprint = fingerprint;
  }

  async ensureBridgePermissions(tools) {
    const permissions = serviceBridgePermissions(this.relayName, tools);
    if (permissions.length === 0) return;
    const fingerprint = JSON.stringify(permissions);
    if (fingerprint === this.permissionsFingerprint) return;
    const response = await fetch(`${this.service.url}/api/session/${this.sessionId}`, {
      method: "PATCH",
      headers: { ...(this.auth ? { Authorization: this.auth } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({ permissions }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode bridge policy update failed (${response.status}): ${errorText.slice(0, 200)}`);
    }
    this.permissionsFingerprint = fingerprint;
    dbg(
      "OPENCODE_SVC",
      `Applied external-agent-only policy session=${this.sessionId} tools=${this.allowedMcpToolNames.size}`
        + ` orchestrator=${this.allowedMcpToolNames.size > 0 ? SERVICE_ORCHESTRATOR_TOOL : "disabled"}`,
    );
  }

  isAllowedToolName(name) {
    return isServiceBridgeToolAllowed(name, {
      relayName: this.relayName,
      tools: [...this.allowedMcpToolNames].map((toolName) => ({ name: toolName })),
    });
  }

  isAllowedPermissionAction(action) {
    return this.isAllowedToolName(action);
  }

  startEvents() {
    if (this.eventsStarted) return this.eventReadyPromise;
    this.eventsStarted = true;
    this.eventReadyPromise = new Promise((resolve, reject) => {
      this.eventReadyResolve = resolve;
      this.eventReadyReject = reject;
    });
    this.eventReadyTimer = setTimeout(() => {
      if (this.eventReadySettled) return;
      this.eventReadySettled = true;
      this.eventReadyReject?.(new Error("OpenCode service event stream connection timed out"));
    }, SERVICE_EVENT_CONNECT_TIMEOUT_MS);
    void this.consumeEvents();
    return this.eventReadyPromise;
  }

  markEventReady() {
    if (this.eventReadySettled) return;
    this.eventReadySettled = true;
    if (this.eventReadyTimer) clearTimeout(this.eventReadyTimer);
    this.eventReadyTimer = null;
    this.eventReadyResolve?.();
  }

  async consumeEvents() {
    while (!this.closed && !this.eventAbort.signal.aborted) {
      try {
        const response = await fetch(`${this.service.url}/api/event`, {
          headers: { Authorization: this.auth },
          signal: this.eventAbort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`event stream ${response.status}`);
        this.markEventReady();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let dataLines = [];
        while (!this.closed && !this.eventAbort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, "");
            if (line === "") {
              if (dataLines.length > 0) {
                this.handleEventPayload(dataLines.join("\n"));
                dataLines = [];
              }
              continue;
            }
            if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
        }
        try { await reader.cancel(); } catch {}
      } catch (error) {
        if (this.closed || this.eventAbort.signal.aborted) break;
        if (!this.eventReadySettled) {
          this.eventReadySettled = true;
          if (this.eventReadyTimer) clearTimeout(this.eventReadyTimer);
          this.eventReadyTimer = null;
          this.eventReadyReject?.(error);
        }
        const isConnRefused = error?.code === "ECONNREFUSED" || error?.message?.includes("ECONNREFUSED") || error?.cause?.code === "ECONNREFUSED";
        if (isConnRefused) {
          this.connRefusedRetries = (this.connRefusedRetries || 0) + 1;
          if (this.connRefusedRetries >= 2) {
            dbg("OPENCODE_SVC", `Event stream for ${this.sessionId}: daemon unreachable (ECONNREFUSED), closing session`);
            this.close();
            break;
          }
        }
        dbg("OPENCODE_SVC", `Event stream for ${this.sessionId} failed: ${error?.message || error}; reconnecting`);
        await new Promise((resolve) => setTimeout(resolve, SERVICE_RECONNECT_DELAY_MS));
      }
    }
  }

  handleEventPayload(payload) {
    if (!payload || payload === "[DONE]") return;
    let event;
    try { event = JSON.parse(payload); } catch { return; }
    if (event?.data?.sessionID && event.data.sessionID !== this.sessionId) return;
    this.lastEventType = event?.type || null;
    this.lastEventAt = Date.now();
    const eventData = event?.data || {};
    if (event?.type === "session.tool.input.started" && eventData.id && eventData.name) {
      this.toolNamesById.set(eventData.id, eventData.name);
    }
    const eventToolId = eventData.id || eventData.assistantMessageID || "-";
    const eventToolName = eventData.name || this.toolNamesById.get(eventData.id) || "-";
    if (DIAGNOSTIC_EVENT_TYPES.has(event?.type)) {
      dbg(
        "OPENCODE_SVC_EVENT",
        `session=${this.sessionId} turn=${this.activeTurn ? "active" : "idle"} type=${event.type}`
          + ` id=${eventToolId}`
          + ` tool=${eventToolName}`
          + ` finish=${eventData.finish || eventData.rawFinish || "-"}`
          + ` action=${eventData.action || "-"}`
          + ` source=${eventData.source?.id || "-"}`
          + ` resources=${Array.isArray(eventData.resources) ? eventData.resources.length : 0}`
          + ` pending=${this.pendingCalls.size}`,
      );
    }
    if (event?.type === "permission.asked" && event.data?.id) {
      void this.approvePermission(event.data);
    }
    if (this.activeTurn) this.activeTurn.queue.push({ type: "event", event });
  }

  async approvePermission(request) {
    const requestId = request?.id;
    if (!requestId || this.repliedPermissionIds.has(requestId)) return;
    this.repliedPermissionIds.add(requestId);
    // Do not reject at the permission level, as OpenCode daemon treats rejection as a fatal turn abort.
    // Host safety is strictly enforced downstream by runtime event interception (session.tool.called).
    try {
      const response = await fetch(
        `${this.service.url}/api/session/${this.sessionId}/permission/${encodeURIComponent(requestId)}/reply`,
        {
          method: "POST",
          headers: { Authorization: this.auth, "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "once" }),
        },
      );
      if (!response.ok) {
        throw new Error(`permission reply failed (${response.status})`);
      }
      dbg(
        "OPENCODE_SVC",
        `${allowed ? "Auto-approved" : "Rejected"} bridge permission session=${this.sessionId}`
          + ` request=${requestId} action=${request.action || "-"}`,
      );
    } catch (error) {
      this.repliedPermissionIds.delete(requestId);
      dbg(
        "OPENCODE_SVC",
        `Permission reply failed session=${this.sessionId} request=${requestId}`
          + ` message=${String(error?.message || error).slice(0, 200)}`,
      );
    }
  }

  async handleMcpToolCall({ rpcId, name, arguments: args, sessionId, relay }) {
    if (!this.allowedMcpToolNames.has(name)) {
      throw new Error(`OpenCode bridge rejected unknown external MCP tool: ${name}`);
    }
    const externalId = `call_${crypto.randomUUID().replaceAll("-", "")}`;
    const call = {
      id: externalId,
      rpcId,
      name,
      arguments: args || {},
      sessionId: sessionId || this.sessionId,
      relay,
    };
    this.pendingCalls.set(externalId, call);
    if (this.activeTurn) this.activeTurn.queue.push({ type: "tool_call", call });
    else this.queuedCalls.push(call);
  }

  resolveToolResults(messages) {
    const results = toolResultCandidates(messages);
    if (results.length === 0) return 0;
    let resolved = 0;
    const unmatchedResults = [];
    for (const result of results) {
      const pending = this.pendingCalls.get(result.id);
      if (!pending) {
        unmatchedResults.push(result);
        continue;
      }
      try {
        pending.relay.respond(pending.rpcId, result.content, result.isError);
        this.pendingCalls.delete(result.id);
        resolved++;
      } catch (error) {
        this.pendingCalls.delete(result.id);
        throw error;
      }
    }

    // Some clients rewrite tool IDs while translating between Claude,
    // Responses, and Chat Completions shapes. When there is exactly one
    // pending call and one unmatched result, the call itself is unambiguous.
    // Use that correlation instead of dropping the continuation.
    if (unmatchedResults.length > 0 && this.pendingCalls.size === 1) {
      const pending = this.pendingCalls.values().next().value;
      const result = unmatchedResults[0];
      try {
        pending.relay.respond(pending.rpcId, result.content, result.isError);
        this.pendingCalls.delete(pending.id);
        resolved++;
      } catch (error) {
        this.pendingCalls.delete(pending.id);
        throw error;
      }
    }
    return resolved;
  }

  takeQueuedCalls() {
    const calls = this.queuedCalls;
    this.queuedCalls = [];
    return calls;
  }

  nextPromptText(messages, tools = [], toolChoice) {
    if (!Array.isArray(messages) || messages.length === 0) return "";
    if (!this.hasPrompt) {
      this.hasPrompt = true;
      for (const message of messages) {
        if (message?.role !== "user") continue;
        const key = messageFingerprint(message);
        this.seenUserMessages.set(key, (this.seenUserMessages.get(key) || 0) + 1);
      }
      const normalized = normalizeMcpTools(tools);
      const toolHint = normalized.length > 0
        ? [
          `<bridge_only_instructions>`,
          "This session is an external-agent-only bridge.",
          "CRITICAL REQUIREMENT: Built-in local tools ('read', 'shell', 'write', 'edit', 'grep', 'glob', 'bash') are completely disabled and FORBIDDEN.",
          "NEVER attempt to call 'read' or 'shell'.",
          `  <server name="${this.relayName}">`,
          "    You MUST invoke external tools EXCLUSIVELY through the attached MCP server:",
          ...normalized.map((tool) => `    - ${tool.name}: ${tool.description || "external tool"}`),
          "  </server>",
          `    Format: tools["${this.relayName}"].<tool_name>(...)`,
          "</bridge_only_instructions>",
          "Do not invent, rename, or substitute tool names. The listed tools are owned and executed by the external agent.",
          ...(toolChoice === "required"
            ? ["A tool call is required for this turn."]
              : toolChoice?.function?.name
              ? [`You must call the external tool named ${toolChoice.function.name} for this turn.`]
              : []),
          "",
        ].join("\n")
        : [
          "<bridge_only_instructions>",
          "This session is an external-agent-only bridge with no external tools available.",
          "Do not perform local filesystem, shell, network, or other tool actions.",
          "</bridge_only_instructions>",
          "",
        ].join("\n");
      return `${toolHint}${messagesToPromptText(messages, [], null)}`.trim();
    }
    const seenInRequest = new Map();
    const fresh = messages.filter((message) => {
      if (message?.role !== "user") return false;
      const key = messageFingerprint(message);
      const occurrence = (seenInRequest.get(key) || 0) + 1;
      seenInRequest.set(key, occurrence);
      return occurrence > (this.seenUserMessages.get(key) || 0);
    });
    for (const [key, count] of seenInRequest) {
      if (count > (this.seenUserMessages.get(key) || 0)) this.seenUserMessages.set(key, count);
    }
    const freshPrompt = fresh.map((message) => messagesToPromptText([message], [], null)).filter(Boolean).join("\n\n");
    if (freshPrompt) return freshPrompt;

    // Recovery path for a hot-reloaded/restarted bridge. The OpenCode session
    // can survive while the in-memory MCP pending-call map does not. The
    // session already contains the assistant tool call, so feed the returned
    // result back as a short continuation prompt rather than falling through
    // to the direct wire and burning its 429 retry budget.
    const results = toolResultCandidates(messages);
    if (results.length > 0) {
      const resultText = results.map((result) => serializeToolResult(result.content)).join("\n\n");
      return [
        `[POLICY REMINDER]: Built-in tools ('read', 'shell') are disabled. Invoke external tools exclusively via tools["${this.relayName}"].<tool_name>(...).`,
        "The external tool result is available below. Continue the task from the existing conversation and do not call the same tool again unless necessary.",
        "TOOL RESULT:",
        resultText,
      ].join("\n");
    }

    // Fail-safe continuation: if the client re-sent the history or a sliding window where
    // user message occurrence counts didn't exceed seen counts, but the last message is a user message,
    // use that last user message text so the turn can proceed.
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user") {
      const fallbackText = messagesToPromptText([lastMsg], [], null);
      if (fallbackText) return fallbackText;
    }

    return "";
  }

  async submitPrompt(text, signal) {
    if (!text) return false;
    const response = await fetch(`${this.service.url}/api/session/${this.sessionId}/prompt`, {
      method: "POST",
      headers: { Authorization: this.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text, files: [], delivery: "steer" }),
      signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode service prompt enqueuing failed (${response.status}): ${errorText.slice(0, 200)}`);
    }
    return true;
  }

  beginTurn() {
    if (this.activeTurn) throw new Error(`OpenCode service session ${this.sessionId} is busy`);
    const turn = { queue: new ServiceTurnQueue(), prefetched: [], startedAt: Date.now() };
    this.activeTurn = turn;
    return turn;
  }

  endTurn(turn) {
    if (this.activeTurn === turn) this.activeTurn = null;
    turn.queue.close();
  }

  async interrupt() {
    try {
      await fetch(`${this.service.url}/api/session/${this.sessionId}/interrupt?resume=false`, {
        method: "POST",
        headers: { Authorization: this.auth },
      });
    } catch {}
  }

  close() {
    this.closed = true;
    if (!this.eventReadySettled) {
      this.eventReadySettled = true;
      if (this.eventReadyTimer) clearTimeout(this.eventReadyTimer);
      this.eventReadyTimer = null;
      this.eventReadyReject?.(new Error("OpenCode service session closed"));
    }
    this.eventAbort.abort();
    this.relay?.close();
    this.activeTurn?.queue.close(new Error("OpenCode service session closed"));
    this.activeTurn = null;
    for (const pending of this.pendingCalls.values()) {
      try { pending.relay.respond(pending.rpcId, "OpenCode service session closed", true); } catch {}
    }
    this.pendingCalls.clear();
  }
}

/**
 * Start or reuse an OpenCode daemon dedicated to a specific proxy URL.
 */
function serviceAuthModeKey(apiKey) {
  if (apiKey === undefined) return "native";
  if (!apiKey || apiKey === "public" || apiKey === "Bearer public") return "public";
  return "configured";
}

export async function getDaemonForProxy(proxyUrl = "", { noProxy = "", apiKey } = {}) {
  const authKey = serviceAuthModeKey(apiKey);
  const poolKey = `${proxyUrl || "__default__"}:${noProxy || "__default__"}:${authKey}`;

  if (!proxyUrl && apiKey === undefined) {
    const existingDefault = getOpencodeServiceInfo();
    if (existingDefault && (await isOpencodeServiceAlive(existingDefault))) {
      return existingDefault;
    }
  }

  const existing = proxyDaemonPool.get(poolKey);
  if (existing && !existing.process.killed) {
    if (await isOpencodeServiceAlive(existing)) {
      scheduleDaemonReaper(poolKey, existing);
      return existing;
    }
    try { existing.process.kill(); } catch {}
    proxyDaemonPool.delete(poolKey);
  }

  dbg(
    "OPENCODE_SVC",
    `Starting native OpenCode daemon worker proxy=${displayProxyUrl(proxyUrl)}`
      + ` noProxy=${normalizeServiceNoProxy(noProxy)}`
      + ` auth=${apiKey === "public" ? "public" : apiKey === undefined ? "native" : "configured"}`,
  );
  return new Promise((resolve) => {
    try {
    const env = buildOpenCodeServiceEnv({ proxyUrl, noProxy, apiKey });

      const p = spawn("opencode", ["serve", "--port", "0", "--print-logs"], {
        env,
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      let buffer = "";
      let processLogBuffer = "";
      let settled = false;

      const onData = (data) => {
        const text = data.toString();
        buffer += text;
        processLogBuffer += text;
        const lines = processLogBuffer.split(/\r?\n/);
        processLogBuffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = sanitizeServiceProcessLog(rawLine.trim());
          if (line && isUsefulServiceProcessLog(line)) {
            dbg("OPENCODE_SVC_PROCESS", line.slice(0, 500));
            if (/(?:Free usage limit reached|subscribe to OpenCode Go|Failed to drain Session.*Free usage limit)/i.test(line)) {
              notifyDaemonRateLimit(proxyDaemonPool.get(poolKey)?.url || "", line);
            }
          }
        }
        if (buffer.length > 20_000) buffer = buffer.slice(-20_000);
        const matchUrl = buffer.match(/server listening on (http:\/\/[^\s]+)/);
        const matchPass = buffer.match(/server password ([^\s]+)/);
        if (matchUrl && matchPass && !settled) {
          settled = true;
          const info = {
            url: matchUrl[1],
            password: matchPass[1],
            process: p,
          };
          scheduleDaemonReaper(poolKey, info);
          proxyDaemonPool.set(poolKey, info);
          resolve(info);
        }
      };

      p.stdout.on("data", onData);
      p.stderr.on("data", onData);
      p.on("error", () => {
        if (!settled) {
          settled = true;
          resolve(getOpencodeServiceInfo());
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(getOpencodeServiceInfo());
        }
      }, 4000);
    } catch {
      resolve(getOpencodeServiceInfo());
    }
  });
}

/**
 * Discover active local OpenCode service registration if available.
 */
export function getOpencodeServiceInfo() {
  try {
    const stateFile = process.env.OPENCODE_SERVICE_FILE || DEFAULT_STATE_PATH;
    if (!fs.existsSync(stateFile)) return null;
    const content = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.url === "string" && parsed.password) {
      return {
        url: parsed.url.replace(/\/$/, ""),
        password: String(parsed.password),
        version: parsed.version,
        pid: parsed.pid,
      };
    }
  } catch {
    // Fail-open: ignore unreadable service state
  }
  return null;
}

/**
 * Check if local OpenCode daemon is alive and healthy.
 */
export async function isOpencodeServiceAlive(serviceInfo) {
  if (!serviceInfo) {
    serviceInfo = await getDaemonForProxy();
  }
  if (!serviceInfo?.url || !serviceInfo?.password) return false;
  try {
    const auth = "Basic " + Buffer.from(`opencode:${serviceInfo.password}`).toString("base64");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`${serviceInfo.url}/api/info`, {
      headers: { Authorization: auth },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Format tools array into system prompt instruction schema.
 */
export function formatToolsPrompt(tools, toolChoice) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  const functions = tools.map(t => t.function || t).filter(Boolean);
  if (functions.length === 0) return "";

  const lines = [
    "# Available Tools",
    "You are equipped with the following functions. When you need to retrieve information, run a command, or perform an action, ALWAYS call the appropriate function instead of answering with plain text:",
    "<tools>",
    JSON.stringify(functions, null, 2),
    "</tools>",
    "",
    "CRITICAL RULES FOR CALLING TOOLS:",
    "1. You MUST call tools directly by the exact names defined in the <tools> list above.",
    "2. Do NOT invent aliases, generic wrappers, or substitute one listed tool for another.",
    "3. To call a function, respond ONLY with a JSON object wrapped in `<tool_call>` tag like this:",
    "<tool_call>",
    '{"name": "function_name", "arguments": { ... }}',
    "</tool_call>",
    "4. Pass arguments that match the selected tool's declared schema. Do not send code for a tool unless its schema explicitly requires code.",
    "5. Autonomous Execution: NEVER call an interactive user-question tool. If multiple choices or architectural decisions exist, state your assumptions clearly in your response and proceed autonomously with the recommended option.",
    "Do not explain that you are calling a tool. Output the `<tool_call>` block immediately.",
  ];
  if (toolChoice && typeof toolChoice === "object" && toolChoice.function?.name) {
    lines.push(`You MUST call the function: ${toolChoice.function.name}`);
  }
  return lines.join("\n");
}

/**
 * Format OpenAI message array into OpenCode prompt text.
 */
export function messagesToPromptText(messages, tools, toolChoice) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  let prompt = "";

  const toolsInstruction = formatToolsPrompt(tools, toolChoice);
  if (toolsInstruction) {
    prompt += `${toolsInstruction}\n\n`;
  }

  // Pre-index tool calls by their ID across the entire conversation history
  const toolCallNameById = new Map();
  for (const msg of messages) {
    if (msg?.role === "assistant" && Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const id = tc?.id;
        const name = tc?.function?.name || tc?.name;
        if (id && name) toolCallNameById.set(id, name);
      }
    }
  }

  // If the last message is just tool results, append an instruction to synthesize the final answer
  const lastMsg = messages[messages.length - 1];
  const isPostToolTurn = lastMsg?.role === "tool";

  for (const msg of messages) {
    const role = String(msg?.role || "user").toUpperCase();
    let content = "";
    if (typeof msg?.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg?.content)) {
      content = msg.content.map(p => p?.text || (p?.type === "text" ? p.text : "") || "").filter(Boolean).join("\n");
    }

    // Handle previous assistant tool calls in history
    if (msg?.role === "assistant" && Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
      const callsStr = msg.tool_calls
        .filter(tc => tc && (tc.function?.name || tc.name))
        .map(tc => {
          const fnName = tc.function?.name || tc.name;
          let fnArgs = tc.function?.arguments || tc.arguments || "{}";
          if (typeof fnArgs === "object") fnArgs = JSON.stringify(fnArgs);
          return `<tool_call>\n${JSON.stringify({ name: fnName, arguments: JSON.parse(fnArgs || "{}") }, null, 2)}\n</tool_call>`;
        })
        .join("\n");
      content = content ? `${content}\n${callsStr}` : callsStr;
    }

    // Handle tool results from caller - resolve actual tool name via toolCallNameById
    if (msg?.role === "tool") {
      const toolCallId = msg.tool_call_id || "";
      const toolName = msg.name || toolCallNameById.get(toolCallId) || (tools?.[0]?.function?.name || tools?.[0]?.name) || "tool";
      content = `[TOOL RESULT for ${toolName} (${toolCallId})]:\n${content}`;
    }

    if (content) {
      prompt += `${role}:\n${content}\n\n`;
    }
  }

  if (isPostToolTurn) {
    prompt += "USER:\nPlease use the tool results above to provide your final answer or call another tool if more information is required.\n\n";
  }

  return prompt.trim();
}

// In-memory cache of daemon sessions to prevent burning free-tier session allocations
const daemonSessionCache = new Map();
const MAX_DAEMON_SESSIONS = 100;

function resolveDaemonSessionKey(credentials, model) {
  const rawHeaders = credentials?.rawHeaders || credentials?.headers || {};
  const headerEntries = Object.entries(rawHeaders).reduce((result, [key, value]) => {
    result[key.toLowerCase()] = value;
    return result;
  }, {});
  const explicitSession = headerEntries["x-opencode-session"]
    || headerEntries["x-session-id"]
    || headerEntries["x-conversation-id"]
    || credentials?._opencodeSession
    || credentials?.sessionId
    || credentials?.conversationId
    || credentials?.promptCacheKey;
  const connKey = explicitSession || credentials?.connectionId || credentials?.id || "default";
  return `${connKey}:${model || "default"}`;
}

export function resolveClientWorkingDirectory(credentials, body, messages = []) {
  const rawHeaders = credentials?.rawHeaders || credentials?.headers || {};
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  // 1. Explicit headers from agent/client
  const headerCandidates = [
    lowerHeaders["x-working-directory"],
    lowerHeaders["x-cwd"],
    lowerHeaders["x-project-dir"],
    lowerHeaders["x-project-directory"],
    lowerHeaders["x-project-path"],
    lowerHeaders["x-workspace-folder"],
    lowerHeaders["x-workspace-root"],
    lowerHeaders["x-opencode-directory"],
    lowerHeaders["x-opencode-cwd"],
  ];
  for (const c of headerCandidates) {
    if (typeof c === "string" && c.trim() && (fs.existsSync(c.trim()) || c.trim().startsWith("/"))) {
      return c.trim();
    }
  }

  // 2. Explicit body fields
  const bodyCandidates = [
    body?.location?.directory,
    body?.directory,
    body?.cwd,
    body?.metadata?.directory,
    body?.metadata?.cwd,
    body?.workspace_dir,
    body?.workspace,
  ];
  for (const c of bodyCandidates) {
    if (typeof c === "string" && c.trim() && (fs.existsSync(c.trim()) || c.trim().startsWith("/"))) {
      return c.trim();
    }
  }

  // 3. Extract from messages / system prompt (<env> or Working directory: ...)
  const systemTexts = [];
  if (typeof body?.instructions === "string") systemTexts.push(body.instructions);
  if (typeof body?.system === "string") systemTexts.push(body.system);
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (typeof msg?.content === "string") {
        systemTexts.push(msg.content);
      } else if (Array.isArray(msg?.content)) {
        for (const p of msg.content) {
          if (typeof p?.text === "string") systemTexts.push(p.text);
        }
      }
    }
  }

  const dirRegexes = [
    /<env>[\s\S]*?Working directory:\s*([^\r\n<]+)/i,
    /Working directory:\s*([^\r\n<]+)/i,
    /Current working directory:\s*([^\r\n<]+)/i,
    /Workspace root folder:\s*([^\r\n<]+)/i,
    /Project root:\s*([^\r\n<]+)/i,
  ];

  for (const text of systemTexts) {
    for (const regex of dirRegexes) {
      const match = text.match(regex);
      if (match && match[1]) {
        const candidate = match[1].trim();
        if (candidate && (fs.existsSync(candidate) || candidate.startsWith("/"))) {
          return candidate;
        }
      }
    }
  }

  return process.cwd() || os.homedir();
}

function resolveServiceSessionKey(credentials, model, messages, directory = "") {
  const base = resolveDaemonSessionKey(credentials, model);
  const dirSuffix = directory ? `:dir:${crypto.createHash("sha256").update(directory).digest("hex").slice(0, 8)}` : "";
  if (!base.startsWith(`default:${model || "default"}`)) return `${base}${dirSuffix}`;
  const firstUser = Array.isArray(messages)
    ? messages.find((message) => message?.role === "user")
    : null;
  if (firstUser) {
    const seed = typeof firstUser.content === "string" ? firstUser.content : messageFingerprint(firstUser);
    return `${base}${dirSuffix}:conversation:${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
  }
  return `${base}${dirSuffix}`;
}

/**
 * Dynamically resolves tool names using property schema matching instead of hardcoded lists.
 * If the model calls a generic wrapper with argument keys, this finds whichever
 * declared tool accepts those properties without requiring a fixed tool catalog.
 */
export function resolveClientToolName(name, declaredTools = [], args = {}) {
  if (!name || !Array.isArray(declaredTools) || declaredTools.length === 0) return name;
  const declaredNames = new Set(declaredTools.map(t => t.function?.name || t.name).filter(Boolean));
  if (declaredNames.has(name)) return name;

  const argKeys = Object.keys(args && typeof args === "object" ? args : {});

  // 1. Match by argument properties (schema-driven, zero hardcoded tool names)
  if (argKeys.length > 0) {
    for (const tool of declaredTools) {
      const fn = tool.function || tool;
      const props = Object.keys(fn.parameters?.properties || {});
      if (props.length > 0 && argKeys.some(k => props.includes(k))) {
        return fn.name;
      }
    }
  }

  // 2. Never match generic runner names against tool descriptions; descriptions
  // can mention an unrelated action without identifying the callable tool.
  const GENERIC_NAMES = new Set(["execute", "eval", "code_mode", "tool", "run"]);
  if (GENERIC_NAMES.has(name.toLowerCase())) {
    return name;
  }

  // 3. Match by intent keyword similarity in tool description or schema
  const lowerName = name.toLowerCase();
  for (const tool of declaredTools) {
    const fn = tool.function || tool;
    const targetName = (fn.name || "").toLowerCase();
    const desc = (fn.description || "").toLowerCase();
    if (targetName.includes(lowerName) || desc.includes(lowerName)) {
      return fn.name;
    }
  }

  return name;
}

function isGenericWrapperTool(name) {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  return lower === "execute" || lower === "eval" || lower === "code_mode" || lower === "tool";
}

function unwrapExecuteWrapper(parsedCall, declaredTools = []) {
  if (!parsedCall || typeof parsedCall !== "object") return parsedCall;
  let name = parsedCall.name;
  let args = parsedCall.arguments || {};

  // If parsedCall is a direct tool, resolve dynamically against declared tools
  if (name !== "execute" && name !== "eval" && name !== "code_mode") {
    return {
      ...parsedCall,
      name: resolveClientToolName(name, declaredTools, args),
    };
  }

  const code = args?.code || (typeof args === "string" ? args : "");
  const directCmd = args?.command;

  // If execute has direct "command" property, resolve to whichever tool accepts "command"
  if (directCmd && typeof directCmd === "string") {
    return {
      name: resolveClientToolName("shell", declaredTools, args),
      arguments: args,
    };
  }

  if (typeof code !== "string" || !code.trim()) {
    return {
      ...parsedCall,
      name: resolveClientToolName(name, declaredTools, args),
    };
  }

  // Extended pattern: handles namespaced tool calls and ordinary function syntax.
  const match = code.match(/(?:tools\[["'][^"']+["']\]\.|tools\.)?([a-zA-Z0-9_-]+)\s*\(\s*(\{[\s\S]*?\}|`[\s\S]*?`|"[^"]*"|'[^']*')\s*\)/);
  if (match) {
    try {
      const fnName = match[1];
      const rawArgs = match[2].trim();
      let fnArgs = {};
      if (rawArgs.startsWith("{")) {
        try {
          fnArgs = JSON.parse(rawArgs);
        } catch {
          // Never evaluate model-generated JavaScript. Preserve malformed
          // object syntax as code so the caller can reject or report it.
          fnArgs = { code: rawArgs };
        }
      } else if (rawArgs.startsWith("`") || rawArgs.startsWith('"') || rawArgs.startsWith("'")) {
        // String literal argument (e.g. bash(`git status`)): map to { command: string }
        const unquoted = rawArgs.slice(1, -1);
        fnArgs = { command: unquoted };
      }
      return {
        name: resolveClientToolName(fnName, declaredTools, fnArgs),
        arguments: fnArgs,
      };
    } catch {
      // Keep original if unwrap fails
    }
  }
  return {
    ...parsedCall,
    name: resolveClientToolName(name, declaredTools, args),
  };
}

/**
 * Stream completion via local OpenCode service daemon over HTTP/SSE.
 * Returns a standard Web Response with an SSE stream in OpenAI format.
 * Implements exponential retry on transient rate-limit (429) identical to official CLI schedule.
 */
export async function executeServiceStream({ model, body: requestBody, messages, tools = [], toolChoice, credentials, proxyUrl, proxyNoProxy = "", signal }) {
  const maxRetries = 6;
  const initialDelayMs = 2000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await executeServiceStreamOnceMcp({
        model,
        body: requestBody,
        messages,
        tools,
        toolChoice,
        credentials,
        proxyUrl,
        proxyNoProxy,
        signal,
      });
      return response;
    } catch (err) {
      const isRateLimit = err?.message?.includes("429") || err?.message?.includes("limit reached");
      const isPermanentFreeLimit = /free usage limit|free tier/i.test(err?.message || "");
      if (isRateLimit && !isPermanentFreeLimit && attempt < maxRetries && !signal?.aborted) {
        const delay = Math.min(initialDelayMs * Math.pow(2, attempt), 10000);
        dbg("OPENCODE_SVC", `Rate limited by upstream, retrying attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function executeServiceStreamOnce({ model, messages, tools = [], toolChoice, credentials, proxyUrl, signal }) {
  const service = await getDaemonForProxy(proxyUrl);
  if (!service) {
    throw new Error("Local OpenCode service state not found");
  }

  const auth = "Basic " + Buffer.from(`opencode:${service.password}`).toString("base64");
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
  };

  const cleanModel = String(model || "big-pickle").replace(/^oc\//, "").replace(/\([^()]+\)\s*$/, "").trim();
  const dir = process.cwd() || os.homedir();

  // 1. Resolve or create a persistent session on the local daemon
  const sessionCacheKey = resolveDaemonSessionKey(credentials, cleanModel);
  let sessionId = daemonSessionCache.get(sessionCacheKey);

  if (!sessionId) {
    dbg("OPENCODE_SVC", `Creating local session for model ${cleanModel} in ${dir}`);
    const sRes = await fetch(`${service.url}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: { providerID: "opencode", id: cleanModel },
        location: { directory: dir },
      }),
      signal,
    });

    if (!sRes.ok) {
      const errText = await sRes.text();
      throw new Error(`OpenCode service session creation failed (${sRes.status}): ${errText.slice(0, 200)}`);
    }

    const sData = await sRes.json();
    sessionId = sData?.data?.id;
    if (!sessionId) {
      throw new Error("No session ID returned by OpenCode service");
    }

    if (daemonSessionCache.size >= MAX_DAEMON_SESSIONS) {
      daemonSessionCache.delete(daemonSessionCache.keys().next().value);
    }
    daemonSessionCache.set(sessionCacheKey, sessionId);
  } else {
    dbg("OPENCODE_SVC", `Reusing existing local session ${sessionId} for model ${cleanModel}`);
  }

  const interruptDaemonSession = () => {
    daemonSessionCache.delete(sessionCacheKey);
    fetch(`${service.url}/api/session/${sessionId}/interrupt`, {
      method: "POST",
      headers,
    }).catch(() => {});
  };

  if (signal) {
    if (signal.aborted) {
      interruptDaemonSession();
    } else {
      signal.addEventListener("abort", interruptDaemonSession, { once: true });
    }
  }

  // 2. Connect to the event SSE stream BEFORE sending the prompt so we capture every token
  const eventUrl = `${service.url}/api/event`;
  const eventRes = await fetch(eventUrl, {
    headers: { Authorization: auth },
    signal,
  });

  if (!eventRes.ok || !eventRes.body) {
    throw new Error(`OpenCode service event stream connection failed (${eventRes.status})`);
  }

  const promptText = messagesToPromptText(messages, tools, toolChoice);

  // 3. Send prompt to the session
  dbg("OPENCODE_SVC", `Enqueuing prompt to session ${sessionId}`);
  const pRes = await fetch(`${service.url}/api/session/${sessionId}/prompt`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: promptText,
      files: [],
      delivery: "steer",
    }),
    signal,
  });

  if (!pRes.ok) {
    const errText = await pRes.text();
    throw new Error(`OpenCode service prompt enqueuing failed (${pRes.status}): ${errText.slice(0, 200)}`);
  }

  // 4. Transform internal event SSE to standard OpenAI chat completion SSE chunks
  const responseId = `chatcmpl-${sessionId}`;
  const created = Math.floor(Date.now() / 1000);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformStream = new TransformStream({
    start(controller) {
      this.buffer = "";
      this.hasOutput = false;
      this.toolCallsById = new Map();
      this.resetWatchdog = () => {
        if (this.watchdog) clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => {
          dbg("OPENCODE_SVC", `Watchdog timeout on session ${sessionId}: no response events received within 35s`);
          interruptDaemonSession();
          try {
            const timeoutChunk = {
              error: {
                message: "OpenCode daemon timeout: no response received within 35s",
                type: "timeout_error",
                code: "gateway_timeout",
                status: 504,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(timeoutChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.terminate();
          } catch {}
        }, 35000);
      };
      this.resetWatchdog();
    },
    transform(chunk, controller) {
      this.resetWatchdog();
      this.buffer += decoder.decode(chunk, { stream: true });
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const ev = JSON.parse(jsonStr);
          // Only process events destined for our session
          if (ev.data?.sessionID && ev.data.sessionID !== sessionId) continue;

          if (ev.type === "session.text.delta" && ev.data?.delta) {
            this.hasOutput = true;
            const deltaText = ev.data.delta;
            this.textAccumulator = (this.textAccumulator || "") + deltaText;

            // Check if model is outputting markup tool call
            if (this.textAccumulator.includes("<tool_call>")) {
              const match = this.textAccumulator.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
              if (match) {
                try {
                  let parsedCall = JSON.parse(match[1].trim());
                  parsedCall = unwrapExecuteWrapper(parsedCall, tools);
                  if (parsedCall.name) {
                    const callId = `call_${Date.now()}`;
                    const openAiChunk = {
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model: cleanModel,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: 0,
                                id: callId,
                                type: "function",
                                function: {
                                  name: parsedCall.name,
                                  arguments: typeof parsedCall.arguments === "string" ? parsedCall.arguments : JSON.stringify(parsedCall.arguments || {}),
                                },
                              },
                            ],
                          },
                          finish_reason: "tool_calls",
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
                    this.toolCallEmitted = true;
                    // Reset accumulator
                    this.textAccumulator = "";
                    continue;
                  }
                } catch {
                  // Wait for complete JSON
                }
              }
              // Wait for closing tag before flushing as text
              continue;
            }

            const openAiChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: cleanModel,
              choices: [
                {
                  index: 0,
                  delta: { content: deltaText },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
          } else if (ev.type === "session.reasoning.delta" && ev.data?.delta) {
            this.hasOutput = true;
            const openAiChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: cleanModel,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: ev.data.delta },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
          } else if (ev.type === "session.tool.input.started" && ev.data) {
            this.hasOutput = true;
            this.toolCallEmitted = true;
            const callId = ev.data.id || `call_${Date.now()}`;
            const rawToolName = ev.data.name || "tool";

            if (isGenericWrapperTool(rawToolName)) {
              this.toolCallsById.set(`is_wrapper_${callId}`, true);
              this.toolCallsById.set(`buffered_args_${callId}`, "");
            } else {
              const toolName = resolveClientToolName(rawToolName, tools);
              this.toolCallsById.set(callId, toolName);
              const openAiChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: callId,
                          type: "function",
                          function: {
                            name: toolName,
                            arguments: "",
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
            }
          } else if (ev.type === "session.tool.input.delta" && ev.data?.delta) {
            this.hasOutput = true;
            const callId = ev.data.id;
            if (this.toolCallsById.get(`is_wrapper_${callId}`)) {
              const prev = this.toolCallsById.get(`buffered_args_${callId}`) || "";
              this.toolCallsById.set(`buffered_args_${callId}`, prev + ev.data.delta);
            } else {
              const openAiChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: callId,
                          function: {
                            arguments: ev.data.delta,
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
            }
          } else if (ev.type === "session.tool.called" && ev.data) {
            this.toolCallEmitted = true;
            const callId = ev.data.id;
            let toolName = this.toolCallsById.get(callId) || ev.data.tool || ev.data.name;
            let argsObj = ev.data.input || {};

            if (this.toolCallsById.get(`is_wrapper_${callId}`) && (!argsObj || Object.keys(argsObj).length === 0)) {
              const buffered = this.toolCallsById.get(`buffered_args_${callId}`);
              if (buffered) {
                try { argsObj = JSON.parse(buffered); } catch { argsObj = { code: buffered }; }
              }
            }

            // If model invoked interactive question/ask_user, unblock immediately and convert to text
            if (toolName === "question" || toolName === "ask_user") {
              if (this.watchdog) clearTimeout(this.watchdog);
              const qList = argsObj?.questions || [];
              const qText = qList.map(q => `[Question: ${q.header || ""}] ${q.question || ""}`).join("\n") || argsObj?.question || "Question requested by model.";
              interruptDaemonSession();
              const openAiChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [
                  {
                    index: 0,
                    delta: { content: `\n\n${qText}\n\n` },
                    finish_reason: "stop",
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.terminate();
              return;
            }

            const unwrapped = unwrapExecuteWrapper({ name: toolName, arguments: argsObj }, tools);
            toolName = unwrapped.name || resolveClientToolName(toolName, tools, unwrapped.arguments || argsObj);
            argsObj = unwrapped.arguments || argsObj;

            if (toolName && !this.toolCallsById.has(`emitted_${callId}`)) {
              this.toolCallsById.set(`emitted_${callId}`, true);
              const argsStr = typeof argsObj === "string" ? argsObj : JSON.stringify(argsObj);
              const openAiChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: callId,
                          type: "function",
                          function: {
                            name: toolName,
                            arguments: argsStr,
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
            }
          } else if (ev.type === "session.execution.succeeded") {
            if (this.watchdog) clearTimeout(this.watchdog);
            const finishReason = this.toolCallEmitted ? "tool_calls" : "stop";
            const finalChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model: cleanModel,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: finishReason,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.terminate();
            return;
          } else if (ev.type === "session.execution.failed") {
            daemonSessionCache.delete(sessionCacheKey);
            const errMsg = ev.data?.error?.message || "Unknown error";
            const isLimit = errMsg.includes("Free usage limit reached") || errMsg.includes("limit reached");
            const status = isLimit ? 429 : 500;
            const errChunk = {
              error: {
                message: errMsg,
                type: isLimit ? "rate_limit_error" : "api_error",
                code: isLimit ? "rate_limit_exceeded" : "internal_error",
                status,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.terminate();
            return;
          }
        } catch {
          // Ignore event parse errors
        }
      }
    },
    flush(controller) {
      if (this.watchdog) clearTimeout(this.watchdog);
      if (!this.hasOutput) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
    },
  });

  const bodyStream = eventRes.body.pipeThrough(transformStream);

  return new Response(bodyStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-opencode-session": sessionId,
    },
  });
}

async function executeServiceStreamOnceMcp({ model, body: requestBody, messages, tools = [], toolChoice, credentials, proxyUrl, proxyNoProxy = "", signal }) {
  const poolKey = `${proxyUrl || "__default__"}:${proxyNoProxy || "__default__"}:${serviceAuthModeKey(resolveOpenCodeServiceApiKey(credentials))}`;
  touchDaemonActivity(poolKey);

  const service = await getDaemonForProxy(proxyUrl, {
    noProxy: proxyNoProxy,
    apiKey: resolveOpenCodeServiceApiKey(credentials),
  });
  if (!service) throw new Error("Local OpenCode service state not found");

  const cleanModel = String(model || "big-pickle").replace(/^oc\//, "").replace(/\([^()]+\)\s*$/, "").trim();
  const directory = resolveClientWorkingDirectory(credentials, requestBody, messages);
  const sessionCacheKey = resolveServiceSessionKey(credentials, cleanModel, messages, directory);
  const headers = {
    Authorization: serviceAuthHeader(service.password),
    "Content-Type": "application/json",
  };

  let state = serviceSessionPool.get(sessionCacheKey);
  const currentContextLength = JSON.stringify(messages || []).length;
  const isCompacted = state && state.lastContextLength > 5000 && currentContextLength < state.lastContextLength * 0.7;
  const isTurnLimitReached = state && state.turnCount >= MAX_SESSION_TURNS;

  if (state?.closed || state?.service?.url !== service.url || state?.lastEventType === "session.execution.failed" || isCompacted || isTurnLimitReached) {
    dbg(
      "OPENCODE_SVC",
      `Evicting/recycling session ${state?.sessionId} from pool for key ${sessionCacheKey}`
        + ` (reason: ${state?.closed ? "closed" : state?.lastEventType === "session.execution.failed" ? "failed" : isCompacted ? "compacted" : isTurnLimitReached ? "turn_limit" : "stale"})`
    );
    state?.close();
    serviceSessionPool.delete(sessionCacheKey);
    state = null;
  }

  if (!state) {
    dbg("OPENCODE_SVC", `Creating local MCP-backed session for model ${cleanModel} in ${directory}`);
    const relayName = serviceRelayName(sessionCacheKey, directory);
    // Omit permissions from creation payload so OpenCode declares required fingerprint tools (read, shell)
    // to upstream Cloudflare WAF, avoiding fake 429 FreeUsageLimitError.
    const sessionPayload = {
      model: { providerID: "opencode", id: cleanModel },
      location: { directory },
    };
    const sessionResponse = await fetch(`${service.url}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify(sessionPayload),
      signal,
    });
    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(`OpenCode service session creation failed (${sessionResponse.status}): ${errorText.slice(0, 200)}`);
    }
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData?.data?.id;
    if (!sessionId) throw new Error("No session ID returned by OpenCode service");

    state = new OpenCodeServiceSession({
      service,
      sessionId,
      model: cleanModel,
      directory,
      cacheKey: sessionCacheKey,
    });
    if (serviceSessionPool.size >= MAX_SERVICE_SESSIONS) {
      const oldestKey = serviceSessionPool.keys().next().value;
      const oldest = serviceSessionPool.get(oldestKey);
      oldest?.close();
      serviceSessionPool.delete(oldestKey);
    }
    serviceSessionPool.set(sessionCacheKey, state);
  }

  try {
    await state.initialize(tools);
  } catch (error) {
    state.close();
    serviceSessionPool.delete(sessionCacheKey);
    throw error;
  }
  state.turnCount++;
  state.lastContextLength = currentContextLength;
  const turn = state.beginTurn();
  dbg(
    "OPENCODE_SVC",
    `Begin turn session=${state.sessionId} model=${cleanModel} cache=${sessionCacheKey}`
      + ` messages=${Array.isArray(messages) ? messages.length : 0} pending=${state.pendingCalls.size}`,
  );
  let resolvedToolResults;
  try {
    // Start consuming events before resolving an MCP tool result. OpenCode can
    // resume the session immediately after the JSON-RPC response is written.
    resolvedToolResults = state.resolveToolResults(messages);
  } catch (error) {
    state.endTurn(turn);
    throw error;
  }
  const queuedCalls = state.takeQueuedCalls();
  const shouldSubmitPrompt = resolvedToolResults === 0 && queuedCalls.length === 0;
  dbg(
    "OPENCODE_SVC",
    `Turn input session=${state.sessionId} resolvedToolResults=${resolvedToolResults}`
      + ` queuedCalls=${queuedCalls.length} submitPrompt=${shouldSubmitPrompt}`
      + ` lastEvent=${state.lastEventType || "-"}`,
  );

  try {
    if (shouldSubmitPrompt) {
      const promptText = state.nextPromptText(messages, tools, toolChoice);
      if (!promptText) {
        // If nextPromptText still didn't produce text (e.g. only assistant messages or empty turn),
        // try serializing the full tail or last message rather than failing to direct wire
        const lastMsg = messages[messages.length - 1];
        const lastRole = lastMsg?.role || lastMsg?.type || "user";
        const contentStr = serializeToolResult(lastMsg?.content || lastMsg?.text || "");
        if (contentStr) {
          const fallbackPrompt = `${String(lastRole).toUpperCase()}:\n${contentStr}`;
          dbg("OPENCODE_SVC", `Using last-message fallback prompt for session=${state.sessionId}`);
          await state.submitPrompt(fallbackPrompt, signal);
        } else {
          const error = new Error("OpenCode service session has no new prompt or pending tool result");
          error.code = "OPENCODE_SERVICE_NO_CONTINUATION";
          dbg(
            "OPENCODE_SVC",
            `No continuation for session=${state.sessionId} cache=${sessionCacheKey} hasPrompt=${state.hasPrompt} pending=${state.pendingCalls.size} messages=${(messages || []).map((message) => `${message?.role || message?.type || "?"}:${message?.tool_call_id || message?.call_id || "-"}`).join(",")}`,
          );
          throw error;
        }
      } else {
        dbg("OPENCODE_SVC", `Submitting prompt session=${state.sessionId} chars=${promptText.length}`);
        await state.submitPrompt(promptText, signal);
      }
    }
  } catch (error) {
    state.endTurn(turn);
    throw error;
  }

  if (queuedCalls.length === 0) {
    try {
      const deadline = Date.now() + 1_500;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const item = await turn.queue.nextWithTimeout(remaining);
        if (!item) break;
        if (item.type === "tool_call") {
          turn.prefetched.push(item);
          break;
        }
        if (item.type === "rate_limit") {
          throw createOpencodeRateLimitError(item.message);
        }
        if (item.type === "closed") {
          throw new Error(`OpenCode service event queue closed for session ${state.sessionId}`);
        }
        if (item.type !== "event") {
          if (item.type === "timeout" || item.type === "aborted") turn.prefetched.push(item);
          break;
        }
        if (item.event?.type === "session.execution.failed") throw serviceExecutionError(item.event);
        if (item.event?.type === "session.execution.interrupted") throw serviceExecutionError(item.event);
        if (["session.text.delta", "session.reasoning.delta", "session.execution.succeeded"].includes(item.event?.type)) {
          turn.prefetched.push(item);
          break;
        }
      }
    } catch (error) {
      state.endTurn(turn);
      throw error;
    }
  }

  const responseId = `chatcmpl-${state.sessionId}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const streamBody = new ReadableStream({
    start(controller) {
      const emit = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      const done = () => controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      const emitError = (error, status = 500) => {
        emit({ error: {
          message: error?.message || String(error),
          type: status === 429 ? "rate_limit_error" : "api_error",
          code: status === 429 ? "rate_limit_exceeded" : "internal_error",
          status,
        } });
        done();
      };
      const emitToolCalls = (calls) => {
        dbg(
          "OPENCODE_SVC",
          `Emitting tool calls session=${state.sessionId} count=${calls.length}`
            + ` names=${calls.map((call) => call.name || "?").join(",")}`,
        );
        calls.forEach((call, index) => emit({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model: cleanModel,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments || {}),
                },
              }],
            },
            finish_reason: null,
          }],
        }));
        emit({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model: cleanModel,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        });
      };
      const emitFinal = () => emit({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model: cleanModel,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });

      const finish = () => {
        dbg(
          "OPENCODE_SVC",
          `Turn complete session=${state.sessionId} pending=${state.pendingCalls.size}`
            + ` lastEvent=${state.lastEventType || "-"}`,
        );
        state.endTurn(turn);
        done();
        controller.close();
      };

      const pump = async () => {
        let watchdogTimeoutMs = SERVICE_TURN_TIMEOUT_MS;
        const watchdog = createServiceTurnWatchdog({
          onTimeout: (timeoutMs) => {
            dbg(
              "OPENCODE_SVC",
              `Turn watchdog timeout session=${state.sessionId} lastEvent=${state.lastEventType || "-"}`
                + ` pending=${state.pendingCalls.size} ageMs=${Date.now() - turn.startedAt}`
                + ` idleMs=${state.lastEventAt ? Date.now() - state.lastEventAt : "never"}`
                + ` timeoutMs=${timeoutMs}`,
            );
            void state.interrupt();
            turn.queue.push({ type: "timeout" });
          },
        });
        watchdog.reset(watchdogTimeoutMs);
        const onAbort = () => {
          void state.interrupt();
          state.close();
          serviceSessionPool.delete(state.cacheKey);
          turn.queue.push({ type: "aborted" });
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          if (queuedCalls.length > 0) {
            emitToolCalls(queuedCalls);
            finish();
            return;
          }

          while (true) {
            const item = turn.prefetched.length > 0 ? turn.prefetched.shift() : await turn.queue.next();
            if (item.type === "tool_call") {
              // OpenCode can issue multiple MCP calls for one model turn. Give
              // sibling JSON-RPC requests a short chance to arrive before the
              // downstream response is finalized.
              await new Promise((resolve) => setTimeout(resolve, 20));
              const calls = [item.call, ...turn.queue.drainToolCalls()];
              emitToolCalls(calls);
              finish();
              return;
            }
            if (item.type === "closed") {
              throw new Error(`OpenCode service event queue closed for session ${state.sessionId}`);
            }
            if (item.type === "rate_limit") {
              const error = createOpencodeRateLimitError(item.message);
              emitError(error, 429);
              state.endTurn(turn);
              controller.error(error);
              return;
            }
            if (item.type === "timeout") {
              await state.interrupt();
              emitError(new Error(`OpenCode daemon timeout: no response received within ${watchdogTimeoutMs}ms`), 504);
              state.endTurn(turn);
              controller.close();
              return;
            }
            if (item.type === "aborted") {
              emitError(new Error("OpenCode service request aborted"), 499);
              state.endTurn(turn);
              controller.close();
              return;
            }
            if (item.type !== "event") continue;
            const event = item.event;
            const eventToolName = event.data?.name
              || event.data?.tool
              || state.toolNamesById.get(event.data?.id);
            if (["session.tool.input.started", "session.tool.called"].includes(event.type)
              && eventToolName
              && !state.isAllowedToolName(eventToolName)) {
              dbg(
                "OPENCODE_SVC",
                `Intercepted non-bridge tool session=${state.sessionId} tool=${eventToolName}`,
              );
              // Instead of aborting the whole session, reject the local tool and feed explanation back to the model
              void state.submitPrompt(`TOOL RESULT:\n[TOOL ERROR]: Local tool "${eventToolName}" is disabled in strict bridge mode. Use external tools via tools["${state.relayName}"].<tool_name>(...).`);
              continue;
            }
            if (event.type === "session.tool.called"
              && eventToolName === SERVICE_ORCHESTRATOR_TOOL
              && !isBridgeOnlyOrchestratorInput(event.data?.input, state.relayName)) {
              dbg("OPENCODE_SVC", `Intercepted non-bridge orchestrator input session=${state.sessionId}`);
              const disallowedCode = String(event.data?.input?.code || "");
              const instructionMessage = "Error: Local execution and unattached global helpers are disabled in strict bridge mode. "
                + "Do not call local functions directly. You must invoke external tools exclusively via tools[\"" + state.relayName + "\"].<tool_name>(...).";
              const syntheticResult = `[ORCHESTRATOR ERROR]: ${instructionMessage}\nOriginal input: ${disallowedCode.slice(0, 300)}`;
              
              // Feed the error message back to the session so the model learns and continues autonomously
              void state.submitPrompt(`TOOL RESULT:\n${syntheticResult}`);
              continue;
            }
            if (["session.tool.called", "session.tool.progress", "permission.asked"].includes(event.type)) {
              const requestedTimeout = Number(event.data?.input?.timeout);
              watchdogTimeoutMs = requestedTimeout > 0
                ? Math.max(SERVICE_TOOL_TIMEOUT_MS, requestedTimeout + 5_000)
                : SERVICE_TOOL_TIMEOUT_MS;
            } else if (["session.tool.success", "session.tool.failed"].includes(event.type)) {
              watchdogTimeoutMs = SERVICE_TURN_TIMEOUT_MS;
            }
            watchdog.reset(watchdogTimeoutMs);
            if (event.type === "session.text.delta" && event.data?.delta) {
              emit({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [{ index: 0, delta: { content: event.data.delta }, finish_reason: null }],
              });
              continue;
            }
            if (event.type === "session.reasoning.delta" && event.data?.delta) {
              emit({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [{ index: 0, delta: { reasoning_content: event.data.delta }, finish_reason: null }],
              });
              continue;
            }
            if (event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
              const error = serviceExecutionError(event);
              emitError(error, error.status);
              state.close();
              serviceSessionPool.delete(state.cacheKey);
              state.endTurn(turn);
              if (error.status === 429) {
                controller.error(error);
              } else {
                controller.close();
              }
              return;
            }
            if (event.type === "session.usage.updated" && event.data?.tokens) {
              const inTok = Number(event.data.tokens.input) || 0;
              const outTok = Number(event.data.tokens.output) || 0;
              emit({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: cleanModel,
                choices: [],
                usage: {
                  prompt_tokens: inTok,
                  completion_tokens: outTok,
                  total_tokens: inTok + outTok,
                },
              });
              continue;
            }
            if (event.type === "session.execution.succeeded") {
              emitFinal();
              finish();
              return;
            }
            if (event.type === "session.execution.interrupted") {
              emitError(serviceExecutionError(event), 499);
              state.endTurn(turn);
              controller.close();
              return;
            }
          }
        } catch (error) {
          dbg(
            "OPENCODE_SVC",
            `Turn error session=${state.sessionId} code=${error?.code || "-"}`
              + ` message=${String(error?.message || error).slice(0, 240)}`
              + ` lastEvent=${state.lastEventType || "-"} pending=${state.pendingCalls.size}`,
          );
          state.endTurn(turn);
          try { emitError(error); } catch {}
          try { controller.close(); } catch {}
        } finally {
          watchdog.clear();
          signal?.removeEventListener("abort", onAbort);
        }
      };
      void pump();
    },
    cancel() {
      state.endTurn(turn);
      void state.interrupt();
    },
  });

  return new Response(streamBody, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-opencode-session": state.sessionId,
    },
  });
}
