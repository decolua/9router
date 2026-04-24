/**
 * Session Manager for Antigravity Cloud Code
 */

import crypto from "crypto";
import { MEMORY_CONFIG } from "../config/runtimeConfig";

interface SessionEntry {
    sessionId: string;
    lastUsed: number;
}

// Runtime storage: Key = connectionId, Value = { sessionId, lastUsed }
const runtimeSessionStore = new Map<string, SessionEntry>();

// Periodically evict entries that haven't been used within TTL
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of runtimeSessionStore) {
        if (now - entry.lastUsed > (MEMORY_CONFIG as any).sessionTtlMs) {
            runtimeSessionStore.delete(key);
        }
    }
}, (MEMORY_CONFIG as any).sessionCleanupIntervalMs);

// Allow Node.js to exit even if interval is still active
if ((cleanupInterval as any).unref) (cleanupInterval as any).unref();

/**
 * Get or create a session ID for the given connection.
 */
export function deriveSessionId(connectionId: string | null | undefined): string {
    if (!connectionId) {
        return generateBinaryStyleId();
    }

    const existing = runtimeSessionStore.get(connectionId);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.sessionId;
    }

    // Evict oldest entry if store exceeds max size
    const MAX_SESSIONS = 1000;
    if (runtimeSessionStore.size >= MAX_SESSIONS) {
      const oldest = runtimeSessionStore.keys().next().value;
      if (oldest) runtimeSessionStore.delete(oldest);
    }

    const sessionId = generateBinaryStyleId();
    runtimeSessionStore.set(connectionId, { sessionId, lastUsed: Date.now() });
    return sessionId;
}

/**
 * Generate a Session ID using the binary's exact logic.
 */
export function generateBinaryStyleId(): string {
    return crypto.randomUUID() + Date.now().toString();
}

/**
 * Clears all session IDs
 */
export function clearSessionStore(): void {
    runtimeSessionStore.clear();
}
