/**
 * Per-server Server-Sent Events streams.
 *
 * For stdio servers: spawns (or reuses) the child and pipes its stdout
 * broadcast into a `ReadableStream`. For remote servers: opens an SSE or
 * Streamable-HTTP connection and forwards frames verbatim.
 *
 * The stdio session registration lives here (rather than in `transports.js`)
 * because it is only meaningful when a client is streaming.
 */

import crypto from "crypto";
import { fetch as undiciFetch } from "undici";
import { SessionLifetimeManager } from "../sessionLifetime.js";
import { getMcpHttpAgent } from "../httpAgent.js";
import { getConnections } from "./state.js";
import { spawnLocalServer } from "./transports.js";

const sessionManager = new SessionLifetimeManager("mcp-server", {
  sessionLifetime: 30 * 60 * 1000,
  cleanupInterval: 5 * 60 * 1000,
});

// Automatically expire long-lived stdio sessions.
sessionManager.startCleanupTimer((sessionId, session) => {
  console.log(
    `[mcp-server-manager] Cleaning up expired session ${sessionId} for server ${session.serverId}`,
  );
  if (session.transport?.close) {
    session.transport.close().catch(() => {});
  }
});

/** Register a stdio SSE session. Returns the session id (or `null` if the child is not running). */
export function registerStdioSession(serverId, sendFn) {
  const entry = getConnections().transports.get(`stdio:${serverId}`);
  if (!entry) return null;
  const sid = crypto.randomUUID();
  entry.sessions.set(sid, sendFn);
  sessionManager.addSession(sid, { serverId, type: "stdio", sendFn });
  console.log(
    `[mcp-server-manager] Stdio session registered: ${sid} for server ${serverId} (total: ${entry.sessions.size})`,
  );
  return sid;
}

export function unregisterStdioSession(serverId, sid) {
  const entry = getConnections().transports.get(`stdio:${serverId}`);
  if (!entry) return;
  entry.sessions.delete(sid);
  sessionManager.removeSession(sid);
  console.log(
    `[mcp-server-manager] Stdio session unregistered: ${sid} for server ${serverId} (total: ${entry.sessions.size})`,
  );
}

export function getStdioSessionCount() {
  return sessionManager.getSessionCount();
}

/**
 * Create a `ReadableStream` of SSE events for a single MCP server. For stdio
 * servers, events come from the shared child process. For remote servers, we
 * open a fresh HTTP/SSE connection and forward frames verbatim.
 */
export function createMcpSSEStream(server) {
  const encoder = new TextEncoder();

  if (server.type === "local-stdio") {
    spawnLocalServer(server);
    let sid;

    return new ReadableStream({
      start(controller) {
        const send = (chunk) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {}
        };
        sid = registerStdioSession(server.id, send);

        // MCP SSE handshake: tell the client we're connected.
        send(
          `event: connected\ndata: ${JSON.stringify({ serverId: server.id, serverName: server.name, transport: "stdio" })}\n\n`,
        );
      },
      cancel() {
        if (sid) unregisterStdioSession(server.id, sid);
      },
    });
  }

  return createRemoteStream(server, encoder);
}

function createRemoteStream(server, encoder) {
  let abortController;
  const isSse = server.type === "remote-sse";

  return new ReadableStream({
    async start(controller) {
      abortController = new AbortController();

      try {
        if (isSse) {
          // SSE transport: GET the SSE endpoint and forward the raw byte stream.
          const res = await undiciFetch(server.url, {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              ...(server.headers || {}),
            },
            signal: abortController.signal,
            dispatcher: getMcpHttpAgent(),
          });

          if (!res.ok) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: `HTTP ${res.status}`, serverId: server.id })}\n\n`,
              ),
            );
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
          // Streamable HTTP: emit a `connected` handshake, then POST initialize
          // and forward the streamed reply.
          controller.enqueue(
            encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ serverId: server.id, serverName: server.name, transport: "streamable-http" })}\n\n`,
            ),
          );

          const res = await undiciFetch(server.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream, application/json",
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
              id: 1,
            }),
            signal: abortController.signal,
            dispatcher: getMcpHttpAgent(),
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
            controller.enqueue(
              encoder.encode(
                `event: message\ndata: ${JSON.stringify(json)}\n\n`,
              ),
            );
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ error: err.message, serverId: server.id })}\n\n`,
            ),
          );
        }
      }
      controller.close();
    },
    cancel() {
      if (abortController) abortController.abort();
    },
  });
}
