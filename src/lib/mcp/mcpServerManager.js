// MCP Server Manager
// Manages connections to user-configured MCP servers.
// Supports remote HTTP, SSE, and local stdio transport.
// Adapted from MetaMCP's server proxy architecture.

import { spawn } from "child_process";
import crypto from "crypto";
import { SessionLifetimeManager } from "./sessionManager";

const G_KEY = "__9routerMcpServerConnections";

const STDIO_COOLDOWN_MS = 10_000; // 10 seconds cooldown after crash
const STDIO_QUICK_FAILURE_MS = 5_000; // Process that dies within 5s is a quick failure

const getConnections = () => {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = {
      transports: new Map(), // `stdio:{serverId}` -> entry
      sessions: new Map(), // `session:{sessionId}` -> { serverId, transport }
      cooldowns: new Map(), // cooldownKey -> expiry timestamp
    };
  }
  return globalThis[G_KEY];
};

const sessionManager = new SessionLifetimeManager("mcp-server", {
  sessionLifetime: 30 * 60 * 1000, // 30 minutes max session age
  cleanupInterval: 5 * 60 * 1000, // Check every 5 minutes
});

// Start automatic cleanup on module load
sessionManager.startCleanupTimer((sessionId, session) => {
  console.log(`[mcp-server-manager] Cleaning up expired session ${sessionId} for server ${session.serverId}`);
  if (session.transport?.close) {
    session.transport.close().catch(() => {});
  }
});

// ─── STDIO Cooldown (from MetaMCP) ────────────────────────────────────────

function createCooldownKey(command, args, env) {
  return `${command}:${(args || []).join(",")}:${JSON.stringify(env || {})}`;
}

function isInCooldown(command, args, env) {
  const key = createCooldownKey(command, args, env);
  const expiry = getConnections().cooldowns.get(key);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    getConnections().cooldowns.delete(key);
    return false;
  }
  return true;
}

function setCooldown(command, args, env) {
  const key = createCooldownKey(command, args, env);
  getConnections().cooldowns.set(key, Date.now() + STDIO_COOLDOWN_MS);
  console.log(`[mcp-server-manager] Cooldown set for ${command} ${(args || []).join(" ")} (${STDIO_COOLDOWN_MS}ms)`);
}

function getCooldownRemaining(command, args, env) {
  const key = createCooldownKey(command, args, env);
  const expiry = getConnections().cooldowns.get(key);
  if (!expiry) return 0;
  return Math.max(0, expiry - Date.now());
}

// ─── Remote HTTP/SSE Transport ─────────────────────────────────────────────

/**
 * Send a JSON-RPC request to a remote MCP server via HTTP POST.
 * Returns the parsed JSON-RPC response, or null for fire-and-forget.
 */
async function sendToRemoteServer(server, jsonRpc) {
  const url = server.url;
  if (!url) throw new Error("No URL configured for remote MCP server");

  const store = getConnections();
  if (!store.remoteSessions) store.remoteSessions = new Map();
  let mcpSessionId = store.remoteSessions.get(server.id);

  // Auto-initialize if no session exists and this is not already an initialize call
  if (!mcpSessionId && jsonRpc.method !== "initialize") {
    try {
      console.log(`[mcp-manager] Auto-initializing remote server "${server.name}"...`);
      const initRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(server.headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "9router-mcp", version: "1.0.0" },
          },
          id: `auto-init-${crypto.randomUUID()}`,
        }),
      });

      if (initRes.ok) {
        mcpSessionId = initRes.headers.get("mcp-session-id");
        if (mcpSessionId) {
          store.remoteSessions.set(server.id, mcpSessionId);
          console.log(`[mcp-manager] Successfully auto-initialized "${server.name}", session ID: ${mcpSessionId}`);
        }
      }
    } catch (err) {
      console.error(`[mcp-manager] Auto-initialize failed for "${server.name}":`, err.message);
    }
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(server.headers || {}),
    ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonRpc),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const newSessionId = res.headers.get("mcp-session-id");
    if (newSessionId) {
      store.remoteSessions.set(server.id, newSessionId);
    }

    const contentType = res.headers.get("content-type") || "";

    // Handle SSE response format
    if (contentType.includes("text/event-stream")) {
      const text = await res.text();
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.jsonrpc === "2.0") return data;
          } catch { /* skip non-JSON lines */ }
        }
      }
      throw new Error("No JSON-RPC response found in SSE stream");
    }

    const text = await res.text();
    if (!text || text.trim() === "") {
      return null;
    }

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Failed to parse JSON response: ${e.message}`);
      }
    }

    // Try parsing as JSON anyway
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Unexpected response format: ${contentType}`);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after 30s`);
    }
    throw err;
  }
}

// ─── Local Stdio Transport ─────────────────────────────────────────────────

function spawnLocalServer(server) {
  const store = getConnections();
  const entryKey = `stdio:${server.id}`;
  let entry = store.transports.get(entryKey);
  if (entry?.proc && !entry.proc.killed && entry.proc.exitCode === null) return entry;

  // Check cooldown
  if (isInCooldown(server.command, server.args, server.env)) {
    const remaining = getCooldownRemaining(server.command, server.args, server.env);
    throw new Error(
      `Server "${server.name}" is in cooldown after crash. Retry in ${Math.ceil(remaining / 1000)}s.`
    );
  }

  const commandStartTime = Date.now();

  const proc = spawn(server.command, server.args || [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(server.env || {}) },
    shell: process.platform === "win32",
  });

  entry = { proc, sessions: new Map(), buffer: "", startTime: commandStartTime };
  store.transports.set(entryKey, entry);

  proc.stdout.on("data", (chunk) => {
    entry.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = entry.buffer.indexOf("\n")) >= 0) {
      const raw = entry.buffer.slice(0, idx).trim();
      entry.buffer = entry.buffer.slice(idx + 1);
      if (!raw) continue;
      for (const send of entry.sessions.values()) {
        try { send(`event: message\ndata: ${raw}\n\n`); } catch {}
      }
    }
  });

  proc.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (!msg) return;
    console.log(`[mcp-stdio:${server.name}] stderr:`, msg);
    for (const send of entry.sessions.values()) {
      try { send(`event: stderr\ndata: ${JSON.stringify({ server: server.name, message: msg })}\n\n`); } catch {}
    }
  });

  proc.on("error", (err) => {
    console.error(`[mcp-stdio:${server.name}] process error:`, err.message);
    store.transports.delete(entryKey);
  });

  proc.on("exit", (code, signal) => {
    const runtime = Date.now() - commandStartTime;
    console.log(`[mcp-stdio:${server.name}] exited code=${code} signal=${signal} runtime=${runtime}ms`);

    // Set cooldown for quick failures
    if (runtime < STDIO_QUICK_FAILURE_MS && code !== 0) {
      setCooldown(server.command, server.args, server.env);
    }

    store.transports.delete(entryKey);

    // Notify sessions
    for (const send of entry.sessions.values()) {
      try { send(`event: process_exit\ndata: ${JSON.stringify({ server: server.name, code, signal })}\n\n`); } catch {}
    }
  });

  console.log(`[mcp-stdio:${server.name}] spawned (command: ${server.command} ${(server.args || []).join(" ")})`);
  return entry;
}

function sendToStdioServer(server, jsonRpc) {
  const entryKey = `stdio:${server.id}`;
  const entry = getConnections().transports.get(entryKey);
  if (!entry?.proc?.stdin?.writable) {
    const newEntry = spawnLocalServer(server);
    newEntry.proc.stdin.write(`${JSON.stringify(jsonRpc)}\n`);
    return;
  }
  entry.proc.stdin.write(`${JSON.stringify(jsonRpc)}\n`);
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Send a JSON-RPC request to an MCP server (auto-detects transport).
 * Returns the parsed response, or null for stdio (fire-and-forget, responses come via SSE).
 */
async function sendToMcpServer(server, jsonRpc) {
  if (server.type === "local-stdio") {
    sendToStdioServer(server, jsonRpc);
    return null; // Stdio is fire-and-forget; responses come via SSE
  }
  return await sendToRemoteServer(server, jsonRpc);
}

/**
 * Create a readable SSE stream for an MCP server.
 * For remote servers: connects to the SSE endpoint and forwards events.
 * For stdio servers: spawns the process and streams stdout as SSE.
 */
function createMcpSSEStream(server, onMessage) {
  const encoder = new TextEncoder();

  if (server.type === "local-stdio") {
    const entry = spawnLocalServer(server);
    let sid;

    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk) => {
          try { controller.enqueue(encoder.encode(chunk)); } catch {}
        };
        sid = registerStdioSession(server.id, send);

        // Send initial connected event (MCP SSE handshake pattern)
        send(`event: connected\ndata: ${JSON.stringify({ serverId: server.id, serverName: server.name, transport: "stdio" })}\n\n`);
      },
      cancel() {
        if (sid) unregisterStdioSession(server.id, sid);
      },
    });
    return stream;
  }

  // For remote servers: connect to the SSE endpoint and forward events
  let abortController;
  const stream = new ReadableStream({
    async start(controller) {
      abortController = new AbortController();

      // Determine if this is SSE or HTTP transport
      const isSse = server.type === "remote-sse";

      try {
        if (isSse) {
          // SSE transport: GET to the SSE endpoint
          const res = await fetch(server.url, {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              ...(server.headers || {}),
            },
            signal: abortController.signal,
          });

          if (!res.ok) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: `HTTP ${res.status}`, serverId: server.id })}\n\n`));
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } else {
          // Streamable HTTP: send initialize and stream results
          controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ serverId: server.id, serverName: server.name, transport: "streamable-http" })}\n\n`));

          // For Streamable HTTP, we keep the connection open
          // The client will POST messages via the message endpoint
          // We just need to keep the controller alive
          const res = await fetch(server.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream, application/json",
              ...(server.headers || {}),
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "9router-mcp", version: "1.0.0" } },
              id: 1,
            }),
            signal: abortController.signal,
          });

          const contentType = res.headers.get("content-type") || "";

          if (contentType.includes("text/event-stream")) {
            const reader = res.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } else if (contentType.includes("application/json")) {
            const json = await res.json();
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(json)}\n\n`));
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message, serverId: server.id })}\n\n`));
        }
      }
      controller.close();
    },
    cancel() {
      if (abortController) abortController.abort();
    },
  });

  return stream;
}

// ─── Stdio Session Management ──────────────────────────────────────────────

function registerStdioSession(serverId, sendFn) {
  const entry = getConnections().transports.get(`stdio:${serverId}`);
  if (!entry) return null;
  const sid = crypto.randomUUID();
  entry.sessions.set(sid, sendFn);

  // Track in session manager
  sessionManager.addSession(sid, { serverId, type: "stdio", sendFn });

  console.log(`[mcp-server-manager] Stdio session registered: ${sid} for server ${serverId} (total: ${entry.sessions.size})`);
  return sid;
}

function unregisterStdioSession(serverId, sid) {
  const entry = getConnections().transports.get(`stdio:${serverId}`);
  if (!entry) return;
  entry.sessions.delete(sid);
  sessionManager.removeSession(sid);
  console.log(`[mcp-server-manager] Stdio session unregistered: ${sid} for server ${serverId} (total: ${entry.sessions.size})`);
}

// ─── Status ────────────────────────────────────────────────────────────────

function getServerManagerStatus() {
  const store = getConnections();
  const processes = {};
  for (const [key, entry] of store.transports.entries()) {
    processes[key] = {
      running: !!(entry.proc && !entry.proc.killed && entry.proc.exitCode === null),
      sessions: entry.sessions.size,
      uptime: entry.startTime ? Date.now() - entry.startTime : 0,
    };
  }

  const cooldowns = {};
  for (const [key, expiry] of store.cooldowns.entries()) {
    if (Date.now() < expiry) {
      cooldowns[key] = Math.ceil((expiry - Date.now()) / 1000);
    }
  }

  return {
    processes,
    cooldowns,
    sessions: sessionManager.getSessionCount(),
    uptime: Date.now(),
  };
}

export { sendToMcpServer, createMcpSSEStream, getServerManagerStatus };

