/**
 * MCP Session Lifetime Manager
 *
 * Adapted from MetaMCP's session-lifetime-manager.ts.
 * Tracks sessions with timestamps, supports expiry checks,
 * and periodic cleanup of stale sessions.
 *
 * Uses a global store so it survives hot-reloads in dev mode.
 */

const G_KEY = "__9routerMcpSessions";
const DEFAULT_SESSION_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const getStore = () => {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = {
      sessions: new Map(), // sessionId -> session data
      timestamps: new Map(), // sessionId -> creation timestamp
      lastActivity: new Map(), // sessionId -> last activity timestamp
      cleanupTimer: null,
    };
  }
  return globalThis[G_KEY];
};

class SessionLifetimeManager {
  constructor(name = "mcp", options = {}) {
    this.name = name;
    this.sessionLifetime = options.sessionLifetime || DEFAULT_SESSION_LIFETIME_MS;
    this.cleanupInterval = options.cleanupInterval || DEFAULT_CLEANUP_INTERVAL_MS;
  }

  addSession(sessionId, session) {
    const store = getStore();
    const now = Date.now();
    store.sessions.set(sessionId, session);
    store.timestamps.set(sessionId, now);
    store.lastActivity.set(sessionId, now);
    console.log(`[mcp-session:${this.name}] Added session ${sessionId}`);
  }

  removeSession(sessionId) {
    const store = getStore();
    store.sessions.delete(sessionId);
    store.timestamps.delete(sessionId);
    store.lastActivity.delete(sessionId);
    console.log(`[mcp-session:${this.name}] Removed session ${sessionId}`);
  }

  getSession(sessionId) {
    return getStore().sessions.get(sessionId);
  }

  getAllSessions() {
    return new Map(getStore().sessions);
  }

  touchSession(sessionId) {
    const store = getStore();
    if (store.lastActivity.has(sessionId)) {
      store.lastActivity.set(sessionId, Date.now());
    }
  }

  getSessionAge(sessionId) {
    const store = getStore();
    const timestamp = store.timestamps.get(sessionId);
    return timestamp ? Date.now() - timestamp : undefined;
  }

  getSessionIdleTime(sessionId) {
    const store = getStore();
    const lastAct = store.lastActivity.get(sessionId);
    return lastAct ? Date.now() - lastAct : undefined;
  }

  isSessionExpired(sessionId) {
    const age = this.getSessionAge(sessionId);
    if (age === undefined) return false;
    return age > this.sessionLifetime;
  }

  cleanupExpiredSessions(cleanupCallback) {
    const store = getStore();
    const now = Date.now();
    const expiredSessions = [];

    for (const [sessionId, timestamp] of store.timestamps.entries()) {
      if (now - timestamp > this.sessionLifetime) {
        const session = store.sessions.get(sessionId);
        if (session) {
          expiredSessions.push({ sessionId, session });
        }
      }
    }

    if (expiredSessions.length > 0) {
      console.log(
        `[mcp-session:${this.name}] Cleaning up ${expiredSessions.length} expired session(s): ${expiredSessions.map((s) => s.sessionId).join(", ")}`
      );
      for (const { sessionId, session } of expiredSessions) {
        this.removeSession(sessionId);
        try {
          cleanupCallback(sessionId, session);
        } catch (err) {
          console.error(`[mcp-session:${this.name}] Error cleaning up session ${sessionId}:`, err);
        }
      }
    }
  }

  startCleanupTimer(cleanupCallback) {
    this.stopCleanupTimer();
    const store = getStore();
    store.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions(cleanupCallback);
    }, this.cleanupInterval);
    console.log(`[mcp-session:${this.name}] Cleanup timer started (interval: ${this.cleanupInterval}ms)`);
  }

  stopCleanupTimer() {
    const store = getStore();
    if (store.cleanupTimer) {
      clearInterval(store.cleanupTimer);
      store.cleanupTimer = null;
    }
  }

  getSessionCount() {
    return getStore().sessions.size;
  }

  getSessionIds() {
    return Array.from(getStore().sessions.keys());
  }
}

module.exports = { SessionLifetimeManager };
