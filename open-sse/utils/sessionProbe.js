/**
 * PR-0: Read-only session-identity probe.
 *
 * Purpose: BEFORE committing to any session→account binding strategy, collect real
 * traffic data on how stable each candidate identity signal actually is. This module
 * makes ZERO routing decisions — it only records, in memory, which identity level
 * `resolveSessionIdentity()` resolved to, and whether a few alternative candidate keys
 * (conversation id, first-user-message hash, transport fingerprint) would have stayed
 * stable inside a rolling window.
 *
 * Enable with SESSION_PROBE=1 (or `true`). When disabled every exported function is a
 * cheap no-op so the probe can live in production code paths at negligible cost.
 *
 * Output: a periodic summary log (every SESSION_PROBE_INTERVAL_MS, default 5 min) plus
 * an on-demand snapshot for the dashboard/observability endpoint.
 */

import { createHash } from "crypto";

// Self-contained logger so this module has no dependency on src/ (open-sse must stay
// importable from both the Next.js app and the standalone SSE server).
const probeLog = (level, msg) => {
  const fn = level === "warn" ? console.warn : console.log;
  fn(`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] [SESSION-PROBE] ${msg}`);
};

// Env flag OR a runtime override set from settings (sessionProbeEnabled).
// The override exists so the probe can be toggled from the dashboard without a
// process restart / env change.
const PROBE_ENV_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.SESSION_PROBE || "").toLowerCase()
);
let probeOverride = null; // null = follow env; true/false = forced
function probeEnabled() {
  return probeOverride === null ? PROBE_ENV_ENABLED : probeOverride;
}

/**
 * Enable/disable the probe at runtime (from settings). Pass null to fall back to env.
 * @param {boolean|null} value
 */
export function setSessionProbeEnabled(value) {
  probeOverride = value === null ? null : !!value;
  if (probeEnabled()) startSessionProbe();
  else stopSessionProbe();
}
const REPORT_INTERVAL_MS = Number(process.env.SESSION_PROBE_INTERVAL_MS) || 5 * 60 * 1000;
const WINDOW_MS = Number(process.env.SESSION_PROBE_WINDOW_MS) || 30 * 60 * 1000;

// Tracked identity levels, in priority order (mirrors resolveSessionIdentity()).
const LEVELS = ["client", "assistant_text", "workspace", "connection_fallback", "random"];

const stats = {
  startedAt: Date.now(),
  totalRequests: 0,
  levelHits: Object.fromEntries(LEVELS.map((l) => [l, 0])),
  candidates: {
    // candidateKey -> Map<value, lastSeenMs>
    conversationId: new Map(),
    firstUserMsg: new Map(),
    transport: new Map(),
    clientSessionId: new Map(),
  },
  // For each candidate, count how many distinct values recurred within the window.
  recurrence: {
    conversationId: { seen: 0, recurring: 0 },
    firstUserMsg: { seen: 0, recurring: 0 },
    transport: { seen: 0, recurring: 0 },
    clientSessionId: { seen: 0, recurring: 0 },
  },
};

function hashShort(value) {
  if (value === null || value === undefined) return null;
  // Only hash a bounded prefix: callers pass whole user messages here, and digesting
  // a multi-megabyte prompt on every request is pure waste. 512 chars is far more
  // than enough entropy to tell conversations apart.
  return createHash("sha256").update(String(value).slice(0, 512)).digest("hex").slice(0, 16);
}

/**
 * Read a header from any of the shapes callers realistically pass in:
 * a WHATWG `Headers` instance (has .get), a `Map`, or a plain lowercased object.
 *
 * This matters: `Headers` does NOT support property indexing, so the previous
 * `headers["user-agent"]` access silently produced `undefined` for every real
 * request and the transport dimension was always empty.
 */
function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const direct = headers[name];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return direct[0] || "";
  return "";
}

function firstUserMessageText(body) {
  const messages = body?.messages || body?.input;
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    if (m?.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const text = c.find((p) => p?.type === "text" && typeof p.text === "string");
      if (text) return text.text;
    }
  }
  return null;
}

function conversationIdFrom(body) {
  return (
    body?.conversation_id ||
    body?.conversationId ||
    body?.metadata?.conversation_id ||
    body?.prompt_cache_key ||
    null
  );
}

/**
 * Record one request's resolved identity plus alternative candidate keys.
 * Read-only: does not mutate routing state anywhere.
 *
 * @param {object} p
 * @param {{sessionId: string, ephemeral: boolean, stable: boolean}} p.identity - result of resolveSessionIdentity()
 * @param {string|null} p.level - which level produced the identity (see LEVELS)
 * @param {object} p.body - request body
 * @param {object} p.headers - request headers: a `Headers` instance, a Map, or a plain lowercased object
 * @param {string|null} p.connectionId
 * @param {string|null} p.clientKey - api key id / account identifier for transport fingerprint
 */
export function recordSessionProbe({ identity, level, body, headers = {}, connectionId, clientKey } = {}) {
  if (!probeEnabled()) return;
  try {
    stats.totalRequests += 1;
    if (level && stats.levelHits[level] !== undefined) stats.levelHits[level] += 1;

    const now = Date.now();
    const userAgent = readHeader(headers, "user-agent");
    const clientName = readHeader(headers, "x-client-name");
    const candidateValues = {
      conversationId: conversationIdFrom(body) || null,
      firstUserMsg: firstUserMessageText(body) || null,
      transport:
        userAgent || clientName
          ? `${clientKey || connectionId || "?"}|${userAgent}|${clientName}`
          : null,
      clientSessionId: identity?.sessionId && identity?.stable && level === "client" ? identity.sessionId : null,
    };

    for (const [candidate, raw] of Object.entries(candidateValues)) {
      if (!raw) continue;
      const h = hashShort(raw);
      const map = stats.candidates[candidate];
      const prev = map.get(h);
      stats.recurrence[candidate].seen += 1;
      if (prev && now - prev <= WINDOW_MS) {
        stats.recurrence[candidate].recurring += 1;
      }
      map.set(h, now);
      // Opportunistic pruning to bound memory.
      if (map.size > 5000) {
        for (const [k, t] of map) {
          if (now - t > WINDOW_MS) map.delete(k);
        }
      }
    }
  } catch {
    // Probe must never break the request path.
  }
}

/**
 * Compute the current report without resetting counters.
 */
export function snapshotSessionProbe() {
  const rate = (r) => (r.seen > 0 ? +(r.recurring / r.seen).toFixed(4) : null);
  const levels = {};
  for (const l of LEVELS) {
    levels[l] = {
      count: stats.levelHits[l],
      pct: stats.totalRequests > 0 ? +(stats.levelHits[l] / stats.totalRequests).toFixed(4) : null,
    };
  }
  return {
    enabled: probeEnabled(),
    uptimeMs: Date.now() - stats.startedAt,
    windowMs: WINDOW_MS,
    totalRequests: stats.totalRequests,
    levelHits: levels,
    candidateRecurrence: {
      conversationId: { ...stats.recurrence.conversationId, rate: rate(stats.recurrence.conversationId), distinct: stats.candidates.conversationId.size },
      firstUserMsg: { ...stats.recurrence.firstUserMsg, rate: rate(stats.recurrence.firstUserMsg), distinct: stats.candidates.firstUserMsg.size },
      transport: { ...stats.recurrence.transport, rate: rate(stats.recurrence.transport), distinct: stats.candidates.transport.size },
      clientSessionId: { ...stats.recurrence.clientSessionId, rate: rate(stats.recurrence.clientSessionId), distinct: stats.candidates.clientSessionId.size },
    },
  };
}

function report() {
  const snap = snapshotSessionProbe();
  probeLog(
    "info",
    `requests=${snap.totalRequests} | levels=${LEVELS.map((l) => `${l}:${snap.levelHits[l].pct ?? "-"}`).join(" ")} | ` +
      `recurrence(30m)= conv:${snap.candidateRecurrence.conversationId.rate ?? "-"} ` +
      `firstUser:${snap.candidateRecurrence.firstUserMsg.rate ?? "-"} ` +
      `transport:${snap.candidateRecurrence.transport.rate ?? "-"} ` +
      `clientSid:${snap.candidateRecurrence.clientSessionId.rate ?? "-"}`
  );
}

let timer = null;

export function startSessionProbe() {
  if (!probeEnabled() || timer) return;
  timer = setInterval(report, REPORT_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  probeLog("info", `enabled — reporting every ${REPORT_INTERVAL_MS}ms, window=${WINDOW_MS}ms`);
}

export function stopSessionProbe() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    probeLog("info", "stopped");
  }
}

export function isSessionProbeEnabled() {
  return probeEnabled();
}
