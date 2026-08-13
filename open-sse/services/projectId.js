/**
 * Project ID Service - Fetch and cache real Project IDs from Google Cloud Code API
 *
 *
 * Instead of generating random project IDs (e.g. "useful-spark-a1b2c"),
 * this service fetches the real Project ID bound to the authenticated user's account.
 * This significantly reduces the risk of being flagged by Google's anti-abuse systems.
 */

import { CLOUD_CODE_API, LOAD_CODE_ASSIST_HEADERS, ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS, LOAD_CODE_ASSIST_METADATA } from "../config/appConstants.js";

// ─── Cache ────────────────────────────────────────────────────────────────────
// connectionId -> { projectId: string, fetchedAt: number }
const projectIdCache = new Map();

/** How long a cached project ID is considered fresh (1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ─── Pending-fetch deduplication ─────────────────────────────────────────────
// connectionId -> { promise: Promise<string|null>, controller: AbortController, startedAt: number }
const pendingFetches = new Map();

/** Abort and evict a pending fetch that has been running longer than this (2 min). */
const PENDING_TTL_MS = 2 * 60 * 1000;

// ─── Periodic cleanup ────────────────────────────────────────────────────────
/** How often the background sweep runs (10 min). */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let _cleanupTimer = null;

/** Run one sweep immediately: evict stale cache entries and abort orphaned pending fetches. */
export function cleanupNow() {
    const now = Date.now();

    for (const [id, entry] of projectIdCache) {
        if (!entry || now - entry.fetchedAt >= CACHE_TTL_MS) {
            projectIdCache.delete(id);
        }
    }

    for (const [id, item] of pendingFetches) {
        if (!item || typeof item.startedAt !== "number") {
            pendingFetches.delete(id);
            continue;
        }
        if (now - item.startedAt > PENDING_TTL_MS) {
            try { item.controller.abort(); } catch (_) { /* ignore */ }
            pendingFetches.delete(id);
        }
    }
}

/** Start the periodic background cleanup (idempotent). Called automatically on module load. */
export function startCacheCleanup() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
        try { cleanupNow(); } catch (e) {
            console.warn("[ProjectId] cleanup sweep error:", e?.message ?? e);
        }
    }, CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't prevent Node from exiting when it is otherwise idle
    _cleanupTimer?.unref?.();
}

/** Stop the periodic background cleanup (e.g. during graceful shutdown). */
export function stopCacheCleanup() {
    if (!_cleanupTimer) return;
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
}

// Start automatically when the module is first imported
startCacheCleanup();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the Project ID for a connection, with caching.
 * Returns null on failure (callers should fall back to random generation).
 *
 * @param {string} connectionId - The connection identifier for cache keying
 * @param {string} accessToken  - Valid OAuth access token
 * @returns {Promise<string|null>} Real project ID or null
 */
export async function getProjectIdForConnection(connectionId, accessToken, provider = "gemini-cli") {
    if (!connectionId || !accessToken) return null;

    // Return cached value if still fresh
    const cached = projectIdCache.get(connectionId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.projectId;
    }

    // Deduplicate concurrent fetches for the same connection
    if (pendingFetches.has(connectionId)) {
        return pendingFetches.get(connectionId).promise;
    }

    // Each fetch gets its own AbortController so it can be canceled via removeConnection()
    const controller = new AbortController();

    const promise = (async () => {
        try {
            const projectId = await fetchProjectId(accessToken, controller.signal, provider);
            if (projectId) {
                projectIdCache.set(connectionId, {projectId, fetchedAt: Date.now()});
                return projectId;
            }
            console.warn("[ProjectId] could not fetch projectId for connection", connectionId.slice(0, 8));
            return null;
        } catch (error) {
            console.warn(`[ProjectId] Error fetching project ID: ${error.message}`);
            return null;
        } finally {
            pendingFetches.delete(connectionId);
        }
    })();

    pendingFetches.set(connectionId, {promise, controller, startedAt: Date.now()});
    return promise;
}

/**
 * Invalidate the cached project ID for a connection.
 * Call this when a connection's credentials are fully revoked or refreshed.
 */
export function invalidateProjectId(connectionId) {
    projectIdCache.delete(connectionId);
}

/**
 * Fully remove a connection: abort any in-flight fetch and delete its cached project ID.
 * Wire this into your connection close / disconnect lifecycle events to prevent memory leaks.
 *
 * @param {string} connectionId
 */
export function removeConnection(connectionId) {
    if (!connectionId) return;
    projectIdCache.delete(connectionId);
    const pending = pendingFetches.get(connectionId);
    if (pending) {
        try { pending.controller.abort(); } catch (_) { /* ignore */ }
        pendingFetches.delete(connectionId);
    }
}

/**
 * Single Authoritative Project Resolver for Antigravity & Gemini CLI connections.
 * Resolution hierarchy:
 * 1. credentials.projectId (trimmed)
 * 2. persisted connection data.projectId
 * 3. cached project ID in memory
 * 4. API discovery (loadCodeAssist / onboardUser) if it yields a valid non-empty string
 * 5. Returns null on failure (callers MUST NOT fallback to random project IDs)
 */
export async function resolveAntigravityProjectId({ credentials, connectionId, accessToken, provider = "antigravity" }) {
    if (!credentials && !connectionId) return null;

    // 1. Direct credentials.projectId
    const credPid = typeof credentials?.projectId === "string" ? credentials.projectId.trim() : null;
    if (credPid) return credPid;

    // 2. Underlying connection data
    const connPid = typeof credentials?._connection?.projectId === "string" ? credentials._connection.projectId.trim() : null;
    if (connPid) return connPid;

    const connId = connectionId || credentials?.connectionId || credentials?.id;

    // 3. Cache lookup
    if (connId) {
        const cached = projectIdCache.get(connId);
        if (cached && cached.projectId && typeof cached.projectId === "string" && cached.projectId.trim()) {
            return cached.projectId.trim();
        }
    }

    // 4. API discovery (loadCodeAssist / onboardUser)
    const token = accessToken || credentials?.accessToken;
    if (connId && token) {
        const discovered = await getProjectIdForConnection(connId, token, provider);
        if (discovered && typeof discovered === "string" && discovered.trim()) {
            return discovered.trim();
        }
    }

    // 5. Resolution failed
    return null;
}


// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch project ID via loadCodeAssist endpoint.
 * Falls back to onboardUser when loadCodeAssist returns no project.
 *
 * @param {string}      accessToken
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function fetchProjectId(accessToken, signal, provider) {
    const endpoints = CLOUD_CODE_API[provider] || CLOUD_CODE_API["gemini-cli"];
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const response = await fetch(endpoints.loadCodeAssist, {
        method: "POST",
        headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify({ metadata: LOAD_CODE_ASSIST_METADATA }),
        signal
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`loadCodeAssist failed: HTTP ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const projectId = extractProjectId(data);
    if (projectId) return projectId;

    // Determine the tier to use for onboarding
    let tierID = "legacy-tier";
    if (Array.isArray(data.allowedTiers)) {
        for (const tier of data.allowedTiers) {
            if (tier && typeof tier === "object" && tier.isDefault === true) {
                if (tier.id && typeof tier.id === "string" && tier.id.trim()) {
                    tierID = tier.id.trim();
                    break;
                }
            }
        }
    }

    return onboardUser(accessToken, tierID, signal, endpoints, provider);
}

/**
 * Fetch project ID via onboardUser endpoint (polls until done).
 *
 * @param {string}      accessToken
 * @param {string}      tierID
 * @param {AbortSignal} externalSignal  – propagated from the connection's AbortController
 * @returns {Promise<string|null>}
 */
async function onboardUser(accessToken, tierID, externalSignal, endpoints, provider) {
    console.log(`[ProjectId] Onboarding user with tier: ${tierID}`);

    const reqBody = { tierId: tierID, metadata: LOAD_CODE_ASSIST_METADATA };
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Bail out immediately if the connection was removed
        if (externalSignal?.aborted) return null;

        // Per-attempt timeout controller; forwards external abort as well
        const localCtrl = new AbortController();
        const timeoutId = setTimeout(() => localCtrl.abort(), 30_000);
        const forwardAbort = () => localCtrl.abort();
        externalSignal?.addEventListener("abort", forwardAbort);

        try {
            const response = await fetch(endpoints.onboardUser, {
                method: "POST",
                headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
                body: JSON.stringify(reqBody),
                signal: localCtrl.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                throw new Error(`onboardUser HTTP ${response.status}: ${errorText.slice(0, 200)}`);
            }

            const data = await response.json();

            if (data.done === true) {
                const projectId = extractProjectIdFromOnboard(data);
                if (projectId) {
                    console.log(`[ProjectId] Successfully onboarded, project ID: ${projectId}`);
                    return projectId;
                }
                console.warn("[ProjectId] onboardUser completed but no project ID returned");
                return null;
            }


            // Server not done yet – wait and retry
            console.log(`[ProjectId] Onboard attempt ${attempt}/${MAX_ATTEMPTS}: not done yet, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
                console.warn(`[ProjectId] onboardUser attempt ${attempt} aborted (timeout or connection removed)`);
                if (externalSignal?.aborted) return null;   // connection gone – stop retrying
                continue;
            }
            if (attempt === MAX_ATTEMPTS) {
                console.warn(`[ProjectId] onboardUser failed after ${MAX_ATTEMPTS} attempts: ${error.message}`);
                return null;
            }
            // Continue to next attempt instead of throwing (which would skip remaining retries)
            console.warn(`[ProjectId] onboardUser attempt ${attempt} failed: ${error.message}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener("abort", forwardAbort);
        }
    }

    return null;
}

function parseProjectIdVal(val) {
    if (!val) return null;
    if (typeof val === "string" && val.trim()) {
        const cleaned = val.replace(/^projects\//, "").trim();
        if (cleaned) return cleaned;
    }
    if (typeof val === "object") {
        const id = val.id || val.projectId || val.projectNumber || val.name;
        if (id != null) {
            const cleaned = String(id).replace(/^projects\//, "").trim();
            if (cleaned) return cleaned;
        }
    }
    return null;
}

/**
 * Extract project ID from loadCodeAssist response.
 */
function extractProjectId(data) {
    if (!data) return null;
    return parseProjectIdVal(data.cloudaicompanionProject) ||
           parseProjectIdVal(data.projectId) ||
           parseProjectIdVal(data.project);
}

/**
 * Extract project ID from onboardUser response.
 */
function extractProjectIdFromOnboard(data) {
    if (!data) return null;
    const resp = data.response || data;
    return parseProjectIdVal(resp.cloudaicompanionProject) ||
           parseProjectIdVal(resp.projectId) ||
           parseProjectIdVal(resp.project);
}
