/**
 * Session lifetime manager.
 *
 * Tracks sessions with creation/activity timestamps, expires stale entries,
 * and runs periodic cleanup. State is kept on `globalThis` so it survives
 * Next.js hot reloads in dev.
 */

const G_KEY = "__9routerMcpSessions";
const DEFAULT_SESSION_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function getStore() {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = {
      sessions: new Map(),
      timestamps: new Map(),
      lastActivity: new Map(),
      cleanupTimer: null,
    };
  }
  return globalThis[G_KEY];
}

export class SessionLifetimeManager {
  constructor(name = "mcp", options = {}) {
    this.name = name;
    this.sessionLifetime =
      options.sessionLifetime || DEFAULT_SESSION_LIFETIME_MS;
    this.cleanupInterval =
      options.cleanupInterval || DEFAULT_CLEANUP_INTERVAL_MS;
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
    const timestamp = getStore().timestamps.get(sessionId);
    return timestamp ? Date.now() - timestamp : undefined;
  }

  getSessionIdleTime(sessionId) {
    const lastAct = getStore().lastActivity.get(sessionId);
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
    const expired = [];

    for (const [sessionId, timestamp] of store.timestamps.entries()) {
      if (now - timestamp > this.sessionLifetime) {
        const session = store.sessions.get(sessionId);
        if (session) expired.push({ sessionId, session });
      }
    }

    if (expired.length === 0) return;

    console.log(
      `[mcp-session:${this.name}] Cleaning up ${expired.length} expired session(s): ${expired
        .map((s) => s.sessionId)
        .join(", ")}`,
    );
    for (const { sessionId, session } of expired) {
      this.removeSession(sessionId);
      try {
        cleanupCallback(sessionId, session);
      } catch (err) {
        console.error(
          `[mcp-session:${this.name}] Error cleaning up session ${sessionId}:`,
          err,
        );
      }
    }
  }

  startCleanupTimer(cleanupCallback) {
    this.stopCleanupTimer();
    const store = getStore();
    store.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions(cleanupCallback);
    }, this.cleanupInterval);
    console.log(
      `[mcp-session:${this.name}] Cleanup timer started (interval: ${this.cleanupInterval}ms)`,
    );
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
