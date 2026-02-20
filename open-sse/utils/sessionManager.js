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
// Map to store latest thinking signatures by session ID for side-channel passing
const runtimeSignatureStore = new Map();

/**
 * Get or create a session ID for a given connection/account.
 * Uses the binary-compatible format: UUID + timestamp
 * uniqueKey should be accountEmail (preferred) or connectionId
 */
export function deriveSessionId(uniqueKey) {
    if (!uniqueKey) {
        // Fallback if no key provided, but this won't be cached per connection
        return generateBinaryStyleId();
    }

    if (runtimeSessionStore.has(uniqueKey)) {
        return runtimeSessionStore.get(uniqueKey);
    }

    const newSessionId = generateBinaryStyleId();
    runtimeSessionStore.set(uniqueKey, newSessionId);
    return newSessionId;
}

/**
 * Cache the latest thinking signature for a session.
 * This is used to pass signatures from response handling (gemini-to-openai)
 * to request handling (antigravity executor) side-channel, bypassing
 * the OpenAI intermediate format which drops them.
 */
export function cacheSignature(sessionId, signature) {
    if (!sessionId || !signature) return;
    // DEBUG LOG: Caching signature
    console.log(`[SessionManager] Caching signature for ${sessionId.substring(0, 8)}...: ${signature.substring(0, 20)}...`);
    runtimeSignatureStore.set(sessionId, signature);
}

/**
 * Retrieve the cached thinking signature for a session.
 */
export function getCachedSignature(sessionId) {
    const sig = runtimeSignatureStore.get(sessionId);
    if (sig) {
        // DEBUG LOG: Retrieving signature
        console.log(`[SessionManager] Retrieved signature for ${sessionId.substring(0, 8)}...: ${sig.substring(0, 20)}...`);
    }
    return sig;
}

/**
 * Generate a session ID in the format expected by Antigravity:
 * randomUUID + Date.now()
 */
export function generateBinaryStyleId() {
    return crypto.randomUUID() + Date.now().toString();
}

/**
 * Clear session store (e.g., on restart or config change)
 */
export function clearSessionStore() {
    runtimeSessionStore.clear();
    runtimeSignatureStore.clear();
}
