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
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";

// Runtime storage: Key = connectionId, Value = { sessionId, lastUsed }
const runtimeSessionStore = new Map();
const continuationStore = new Map();

// Periodically evict entries that haven't been used within TTL
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of runtimeSessionStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
            runtimeSessionStore.delete(key);
        }
    }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);

// Allow Node.js to exit even if interval is still active
if (cleanupInterval.unref) cleanupInterval.unref();

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
        return generateBinaryStyleId();
    }

    const existing = runtimeSessionStore.get(connectionId);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.sessionId;
    }

    // Evict oldest entry if store exceeds max size (safety cap between cleanup cycles)
    const MAX_SESSIONS = 1000;
    if (runtimeSessionStore.size >= MAX_SESSIONS) {
      const oldest = runtimeSessionStore.keys().next().value;
      runtimeSessionStore.delete(oldest);
    }

    const sessionId = generateBinaryStyleId();
    runtimeSessionStore.set(connectionId, { sessionId, lastUsed: Date.now() });
    return sessionId;
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
    assistantSessionStore.clear();
    continuationStore.clear();
}

// Conversation-stable session store: Key = hash(scope+assistant text), Value = { sessionId, lastUsed }
const assistantSessionStore = new Map();
const ASSISTANT_MIN_LEN = 50;
const ASSISTANT_CAP_LEN = 50;
const MAX_ASSISTANT_SESSIONS = 5000;
const MAX_CONTINUATION_SESSIONS = 5000;

// Client headers/body fields that carry an upstream session id (priority order)
const SESSION_HEADER_KEYS = ["x-session-id", "session-id", "session_id", "x-amp-thread-id"];
const CLAUDE_CODE_SESSION_RE = /_session_([a-f0-9-]+)$/;
const HERMES_CONTEXT_MARKER = "## Current Session Context";

function sha16(text) {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// Normalize a session id candidate (trim, length cap)
function normalizeSessionId(value) {
    if (typeof value !== "string") return null;
    const v = value.trim();
    if (!v || v.length > 256) return null;
    return v;
}

// Extract Claude Code session id from metadata.user_id (_session_{uuid} | JSON {session_id})
function extractClaudeCodeSession(userId) {
    if (typeof userId !== "string" || !userId) return null;
    const m = userId.match(CLAUDE_CODE_SESSION_RE);
    if (m) return m[1];
    if (userId[0] === "{") {
        try { return normalizeSessionId(JSON.parse(userId)?.session_id); } catch { /* noop */ }
    }
    return null;
}

// Lowercase-key lookup for raw client headers
function headerValue(headers, key) {
    if (!headers || typeof headers !== "object") return null;
    return normalizeSessionId(headers[key] ?? headers[key.toLowerCase()]);
}

// Read client-provided session id from headers/body (no generation)
// Antigravity envelope carries session in request.sessionId; requestId embeds conversation uuid
const ANTIGRAVITY_CONV_RE = /^[a-z]+\/([0-9a-f-]{36})\//i;
function extractAntigravitySession(body) {
    const sid = body?.request?.sessionId;
    if (sid != null && sid !== "") return normalizeSessionId(String(sid));
    const m = typeof body?.requestId === "string" ? body.requestId.match(ANTIGRAVITY_CONV_RE) : null;
    return m ? normalizeSessionId(m[1]) : null;
}

function extractClientSessionId(headers, body, scope = "") {
    const claude = extractClaudeCodeSession(body?.metadata?.user_id);
    if (claude) return `claude:${claude}`;
    const antigravity = extractAntigravitySession(body);
    if (antigravity) return `antigravity:${antigravity}`;
    for (const key of SESSION_HEADER_KEYS) {
        const v = headerValue(headers, key);
        if (v) return v;
    }
    const requestId = scope === "kiro" ? null : headerValue(headers, "x-client-request-id");
    if (requestId) return requestId;
    const fromBody =
        normalizeSessionId(body?.prompt_cache_key) ||
        normalizeSessionId(body?.session_id) ||
        normalizeSessionId(body?.conversation_id) ||
        normalizeSessionId(body?.metadata?.user_id);
    return fromBody || null;
}

function messageContentText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === "string") return part;
            return part?.text || part?.content || part?.input || part?.output || "";
        }).filter(Boolean).join("\n");
    }
    return "";
}

function requestMessages(body) {
    if (Array.isArray(body?.messages)) return body.messages;
    if (Array.isArray(body?.input)) return body.input;
    return [];
}

function firstUserText(messages) {
    for (const item of messages) {
        if (item?.role !== "user") continue;
        const text = messageContentText(item.content);
        if (text) return text;
    }
    return "";
}

function stableHermesContextLines(text) {
    const start = text.indexOf(HERMES_CONTEXT_MARKER);
    if (start < 0) return [];
    const rest = text.slice(start);
    const nextSection = rest.slice(HERMES_CONTEXT_MARKER.length).search(/\n##\s+/);
    const section = nextSection >= 0
        ? rest.slice(0, HERMES_CONTEXT_MARKER.length + nextSection)
        : rest;
    const keep = [];
    for (const raw of section.split(/\r?\n/)) {
        const line = raw.trim();
        if (
            line.startsWith("**Source:**") ||
            line.startsWith("**Session type:**") ||
            line.startsWith("**User ID:**") ||
            line.startsWith("**Matrix Room ID:**") ||
            line.startsWith("**Matrix Thread:**") ||
            line.startsWith("- Guild:") ||
            line.startsWith("- Parent channel:") ||
            line.startsWith("- Thread:") ||
            line.startsWith("- Channel:")
        ) {
            if (!line.includes("Triggering message")) keep.push(line);
        }
    }
    return keep;
}

function extractDurableHermesContextIds(lines) {
    const ids = [];
    const slackThreadTs = "[0-9]{10}\\.[0-9]{6}";
    const durableThreadId = `(?:[0-9]{15,20})|(?:[A-Z][A-Z0-9]{8,})|(?:${slackThreadTs})|(?:\\$[^\\s:]+:[^\\s]+)`;
    const durableChannelId = "(?:[0-9]{15,20})|(?:[A-Z][A-Z0-9]{8,})";
    const sourceIdRe = new RegExp(`\\b(channel):\\s*(${durableChannelId})|\\b(thread):\\s*(${durableThreadId})`, "g");
    let hasThreadLabel = false;
    let hasDurableThread = false;

    for (const line of lines) {
        const source = line.match(/^\*\*Source:\*\*\s*([A-Za-z][A-Za-z0-9_-]*)/);
        if (source) ids.push(`source-platform:${source[1].toLowerCase()}`);

        const matrixRoom = line.match(/^\*\*Matrix Room ID:\*\*\s*(![^\s:]+:[^\s]+)$/);
        if (matrixRoom) ids.push(`matrix-room:${matrixRoom[1]}`);

        const matrixThread = line.match(new RegExp(`^\\*\\*Matrix Thread:\\*\\*\\s*(${durableThreadId})$`));
        if (matrixThread) {
            ids.push(`matrix-thread:${matrixThread[1]}`);
            hasDurableThread = true;
        }

        const discordId = line.match(new RegExp("^\\s*-\\s*(Guild|Parent channel|Thread|Channel):\\s*`(" + durableThreadId + "|" + durableChannelId + ")`"));
        if (discordId) {
            const kind = discordId[1].toLowerCase();
            ids.push(`${kind}:${discordId[2]}`);
            if (kind === "thread") hasDurableThread = true;
        }

        if (/\bthread:\s*/i.test(line) || /^\s*-\s*Thread:/.test(line) || line.startsWith("**Matrix Thread:**")) {
            hasThreadLabel = true;
        }
        for (const match of line.matchAll(sourceIdRe)) {
            const kind = (match[1] || match[3]).toLowerCase();
            const id = match[2] || match[4];
            ids.push(`source-${kind}:${id}`);
            if (kind === "thread") hasDurableThread = true;
        }
    }

    if (hasThreadLabel && !hasDurableThread) return [];
    return [...new Set(ids)].sort();
}

function hermesPayloadSessionEnabled() {
    const value = String(process.env.NINE_ROUTER_KIRO_HERMES_PAYLOAD_SESSION ?? "1").toLowerCase();
    return !["0", "false", "no", "off"].includes(value);
}

function extractHermesPayloadSession(body, scope, connectionId) {
    if (scope !== "kiro") return null;
    if (!connectionId || !hermesPayloadSessionEnabled()) return null;
    const messages = requestMessages(body);
    if (!messages.length) return null;
    let contextLines = [];
    const systemTexts = [];
    if (body?.system) systemTexts.push(messageContentText(body.system));
    for (const item of messages) {
        if (item?.role !== "system" && item?.role !== "developer") continue;
        systemTexts.push(messageContentText(item.content));
    }
    for (const text of systemTexts) {
        contextLines = stableHermesContextLines(text);
        if (contextLines.length) break;
    }
    if (!contextLines.length) return null;
    const durableIds = extractDurableHermesContextIds(contextLines);
    if (!durableIds.length) return null;
    const runtimeSalt = deriveSessionId(`hermes:${connectionId}`);
    return `hermes:${sha16(`${runtimeSalt}\n---\n${durableIds.join("\n")}`)}`;
}

// Accumulate assistant text from OpenAI/Responses-style input/messages (cap-limited)
function accumulateAssistantText(body) {
    const items = requestMessages(body);
    if (!items) return "";
    let text = "";
    for (const item of items) {
        if (item?.role !== "assistant") continue;
        if (typeof item.content === "string") text += item.content;
        else if (Array.isArray(item.content)) {
            for (const c of item.content) text += c?.text || c?.output || "";
        }
        if (text.length >= ASSISTANT_CAP_LEN) break;
    }
    return text;
}

// Stable session id keyed on accumulated assistant text (avoids collision on identical first user prompt)
function assistantTextSessionId(scope, body) {
    const text = accumulateAssistantText(body);
    if (text.length < ASSISTANT_MIN_LEN) return null;
    const hash = sha16(`${scope}:${text.slice(0, ASSISTANT_CAP_LEN)}`);
    const existing = assistantSessionStore.get(hash);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.sessionId;
    }
    if (assistantSessionStore.size >= MAX_ASSISTANT_SESSIONS) {
        assistantSessionStore.delete(assistantSessionStore.keys().next().value);
    }
    const sessionId = generateBinaryStyleId();
    assistantSessionStore.set(hash, { sessionId, lastUsed: Date.now() });
    return sessionId;
}

/**
 * Resolve a conversation-stable session id (generalizes Codex resolveCacheSessionId).
 * Priority: client session → accumulated-assistant-text hash → workspaceId → per-connection.
 *
 * @param {object} opts
 * @param {object} [opts.headers] - Raw client request headers (lowercase keys)
 * @param {object} [opts.body] - Parsed request body
 * @param {string} [opts.connectionId] - Connection identifier (fallback scope)
 * @param {string} [opts.workspaceId] - Provider workspace id (account-wide fallback)
 * @param {string} [opts.scope] - Provider scope to isolate cache keys across providers
 * @returns {string} A stable session id
 */
export function resolveSessionId({ headers, body, connectionId, workspaceId, scope = "" } = {}) {
    const client = extractClientSessionId(headers, body, scope);
    if (client) return client;
    const hermes = extractHermesPayloadSession(body, scope, connectionId);
    if (hermes) return hermes;
    const fromAssistant = scope === "kiro" ? null : assistantTextSessionId(`${scope}:${connectionId || ""}`, body);
    if (fromAssistant) return fromAssistant;
    const ws = normalizeSessionId(workspaceId);
    if (ws) return ws;
    if (scope === "kiro") return generateBinaryStyleId();
    return deriveSessionId(connectionId);
}

export function resolveContinuationId({ sessionId, connectionId, scope = "" } = {}) {
    const key = `${scope}:${connectionId || ""}:${sessionId || ""}`;
    const existing = continuationStore.get(key);
    if (existing) {
        existing.lastUsed = Date.now();
        continuationStore.delete(key);
        continuationStore.set(key, existing);
        return existing.continuationId;
    }
    const continuationId = crypto.randomUUID();
    if (continuationStore.size >= MAX_CONTINUATION_SESSIONS) {
        continuationStore.delete(continuationStore.keys().next().value);
    }
    continuationStore.set(key, { continuationId, lastUsed: Date.now() });
    return continuationId;
}

// Capture session id from request body + credentials (envelope still intact here)
export function captureSessionId(body, credentials, connectionId, scope = "") {
    return resolveSessionId({ headers: credentials?.rawHeaders, body, connectionId, scope });
}

// Convert any session id to Antigravity numeric format "-<int64>" (matches real AG / CLIProxyAPI).
// Already-numeric ids (native AG sessionId) pass through unchanged.
export function toNumericSessionId(sessionId) {
    const v = normalizeSessionId(sessionId);
    if (!v) return null;
    if (/^-?\d+$/.test(v)) return v;
    const h = crypto.createHash("sha256").update(v).digest();
    const n = h.readBigUInt64BE(0) & 0x7fffffffffffffffn;
    return `-${n.toString()}`;
}

// Cleanup expired assistant-session entries
const assistantCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of assistantSessionStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) assistantSessionStore.delete(key);
    }
    for (const [key, entry] of continuationStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) continuationStore.delete(key);
    }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (assistantCleanup.unref) assistantCleanup.unref();
