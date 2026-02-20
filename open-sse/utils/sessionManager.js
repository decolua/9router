/**
 * Session Manager for Antigravity Cloud Code
 *
 * Handles session ID generation and caching for prompt caching continuity.
 * Mimics the Antigravity binary behavior: generates a session ID at startup
 * and keeps it for the process lifetime, scoped per account/connection.
 *
 * Reference: antigravity-claude-proxy/src/cloudcode/session-manager.js
 */

import crypto from "crypto";

// Runtime storage for session IDs (per connection/account)
// Key: connectionId (email or identifier), Value: sessionId
const runtimeSessionStore = new Map();

/**
 * Get or create a session ID for the given connection.
 *
 * The binary generates a session ID once at startup: `rs() + Date.now()`.
 * Since 9router is long-running, we simulate this "per-launch" behavior by
 * storing a generated ID in memory for each connection.
 *
 * - If 9router restarts, the ID changes (matching binary restart behavior).
 * - Within a running instance, the ID is stable for that connection.
 * - This enables prompt caching while using the EXACT random logic of the binary.
 *
 * @param {string} connectionId - The connection identifier (email or unique ID)
 * @returns {string} A stable session ID string matching binary format
 */
export function deriveSessionId(connectionId) {
    if (!connectionId) {
        // Fallback for requests without a connection identifier
        return generateBinaryStyleId();
    }

    // Check if we already have a session ID for this connection in this process run
    if (runtimeSessionStore.has(connectionId)) {
        return runtimeSessionStore.get(connectionId);
    }

    // Generate a new ID using the binary's exact logic
    const newSessionId = generateBinaryStyleId();

    // Store it for future requests from this connection
    runtimeSessionStore.set(connectionId, newSessionId);

    return newSessionId;
}

/**
 * Generate a Session ID using the binary's exact logic.
 * Format: `rs() + Date.now()` where `rs()` is randomUUID
 *
 * @returns {string} A session ID in binary format
 */
export function generateBinaryStyleId() {
    return crypto.randomUUID() + Date.now().toString();
}

/**
 * Clears all session IDs (e.g. useful for testing or explicit reset)
 */
export function clearSessionStore() {
    runtimeSessionStore.clear();
}
