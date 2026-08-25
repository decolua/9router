/**
 * Gateway-level session management and status snapshots.
 *
 * A "gateway session" is a client SSE connection to `/api/mcp-gateway/sse`
 * that fans out to every active upstream server. This module tracks those
 * sessions and provides the broadcast primitive used to notify all connected
 * clients of change events (e.g. `tools/list_changed`).
 */

import { getConnections } from "./state.js";
import { getStdioSessionCount } from "./sseStream.js";

// ─── Gateway sessions ──────────────────────────────────────────────────────

export function registerGatewaySession(sessionId, send, ownerId = null) {
  getConnections().gatewaySessions.set(sessionId, {
    send,
    ownerId,
    createdAt: Date.now(),
  });
}

export function unregisterGatewaySession(sessionId) {
  getConnections().gatewaySessions.delete(sessionId);
}

export function getGatewaySession(sessionId) {
  return getConnections().gatewaySessions.get(sessionId);
}

/**
 * Broadcast a JSON-RPC notification to every active gateway SSE session.
 * Returns the number of sessions the notification was delivered to.
 */
export function broadcastGatewayNotification(notification) {
  const sessions = getConnections().gatewaySessions;
  if (!sessions || sessions.size === 0) return 0;
  const payload = `event: message\ndata: ${JSON.stringify(notification)}\n\n`;
  let delivered = 0;
  for (const session of sessions.values()) {
    try {
      session.send(payload);
      delivered++;
    } catch {
      // Ignore broken/closed sessions; cleanup happens on stream cancel.
    }
  }
  return delivered;
}

/**
 * Notify connected MCP clients that the aggregated tool set has changed so
 * they re-fetch `tools/list`. Emitted when servers are added/removed/toggled.
 */
export function notifyToolsListChanged() {
  return broadcastGatewayNotification({
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
  });
}

// ─── Status ────────────────────────────────────────────────────────────────

/** Snapshot of every user-configured server process plus active cooldowns. */
export function getServerManagerStatus() {
  const store = getConnections();
  const processes = {};
  for (const [key, entry] of store.transports.entries()) {
    processes[key] = {
      running: !!(
        entry.proc &&
        !entry.proc.killed &&
        entry.proc.exitCode === null
      ),
      sessions: entry.sessions.size,
      uptime: entry.startTime ? Date.now() - entry.startTime : 0,
    };
  }

  const cooldowns = {};
  const now = Date.now();
  for (const [key, expiry] of store.cooldowns.entries()) {
    if (now < expiry) {
      cooldowns[key] = Math.ceil((expiry - now) / 1000);
    }
  }

  return {
    processes,
    cooldowns,
    sessions: getStdioSessionCount(),
    uptime: now,
  };
}
