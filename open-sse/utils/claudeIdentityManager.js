import { createHash } from "node:crypto";

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "cookie", "set-cookie"]);
const CLIENT_PREFERRED_HEADERS = new Set(["accept", "content-type", "accept-encoding", "content-encoding", "cache-control"]);
const IDENTITY_HEADER_NAMES = new Set([
  "user-agent", "anthropic-version", "anthropic-beta",
  "anthropic-dangerous-direct-browser-access", "x-app", "x-client-version",
]);
const STATE_KEY = Symbol.for("9router.claudeIdentityManager.state");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const STALE_MISSING_CAPTURE_COUNT = 2;

function getState() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = { identities: new Map(), lastExecutorBuild: null };
  return globalThis[STATE_KEY];
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return null;
  const normalized = {};
  const entries = typeof headers.entries === "function" ? headers.entries() : Object.entries(headers);
  for (const [name, value] of entries) {
    if (value !== undefined && value !== null) normalized[String(name).toLowerCase()] = String(value);
  }
  return normalized;
}

function valueHash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function readDuration(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getNow(value) {
  return Number.isFinite(value) ? value : Date.now();
}

function getIdentityTiming() {
  return {
    ttlMs: readDuration("CLAUDE_IDENTITY_TTL_MS", DEFAULT_TTL_MS),
    staleAfterMs: readDuration("CLAUDE_IDENTITY_STALE_AFTER_MS", DEFAULT_STALE_AFTER_MS),
  };
}

function isNeverReplayHeader(name) {
  return HOP_BY_HOP_HEADERS.has(name)
    || name === "x-real-ip"
    || name.startsWith("x-forwarded-")
    || name.startsWith("x-9r-")
    || name.startsWith("cf-")
    || name.startsWith("fly-")
    || name.startsWith("vercel-");
}

export function classifyClaudeIdentityHeader(name) {
  const normalized = String(name || "").toLowerCase();
  if (isNeverReplayHeader(normalized)) return "neverReplay";
  if (SENSITIVE_HEADERS.has(normalized)) return "sensitiveClientPreferred";
  if (CLIENT_PREFERRED_HEADERS.has(normalized)) return "clientPreferred";
  if (IDENTITY_HEADER_NAMES.has(normalized)
    || normalized.startsWith("anthropic-")
    || normalized.startsWith("x-stainless-")
    || normalized.startsWith("x-claude-")
    || normalized.startsWith("x-client-")) return "identityReplay";
  return "observeOnly";
}

export function isClaudeCodeClient(headers) {
  const normalized = normalizeHeaders(headers);
  if (!normalized) return false;
  const userAgent = (normalized["user-agent"] || "").toLowerCase();
  return userAgent.includes("claude-cli") || userAgent.includes("claude-code") || (normalized["x-app"] || "").toLowerCase() === "cli";
}

function isClaudeMessagesRequest(body, path) {
  return /^\/(?:api\/)?v1\/messages$/.test(path || "")
    && body && typeof body === "object"
    && typeof body.model === "string" && body.model.length > 0
    && Array.isArray(body.messages);
}

// A recognizable User-Agent alone is intentionally insufficient: it is easy to
// forge and must never be able to refresh process-wide identity state.
export function isTrustedClaudeIdentitySource(headers, body, source = {}) {
  const normalized = normalizeHeaders(headers);
  if (!normalized || !isClaudeMessagesRequest(body, source.path)) return false;
  if (source.authenticated !== true && source.local !== true) return false;

  const userAgent = (normalized["user-agent"] || "").toLowerCase();
  const signals = [
    userAgent.includes("claude-cli") || userAgent.includes("claude-code"),
    (normalized["x-app"] || "").toLowerCase() === "cli",
    Boolean(normalized["anthropic-version"] || normalized["anthropic-beta"]),
    Object.keys(normalized).some((name) => name.startsWith("x-stainless-") || name.startsWith("x-claude-")),
  ].filter(Boolean).length;
  return signals >= 2;
}

function makeHeader(name, value, policy, now, existing) {
  const changed = existing && existing.valueHash !== valueHash(value);
  const header = {
    name,
    valueHash: valueHash(value),
    valueLength: value.length,
    policy,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    seenCount: (existing?.seenCount || 0) + 1,
    changedCount: (existing?.changedCount || 0) + (changed ? 1 : 0),
    missingCount: 0,
    stale: false,
    persisted: false,
  };
  // Only explicitly replayable identity fields retain a value in memory.
  // Credentials, transport headers, and unknown fields are summary-only.
  if (policy === "identityReplay") header.value = value;
  return header;
}

export function captureClaudeIdentity(headers, source = {}) {
  const normalized = normalizeHeaders(headers);
  if (!normalized || !source.namespace || !isTrustedClaudeIdentitySource(normalized, source.body, source)) return false;

  const state = getState();
  const now = getNow(source.now);
  const existing = state.identities.get(source.namespace);
  const capturedHeaders = { ...(existing?.headers || {}) };
  const previousHeaderCount = Object.keys(capturedHeaders).length;
  const observedHeaderCount = Object.keys(normalized).length;
  // An unusually sparse request must not replace a complete identity with a
  // partial one. Keep the last known replay values and record the anomaly.
  const degraded = previousHeaderCount > 0 && observedHeaderCount * 2 < previousHeaderCount;
  const observedNames = new Set(Object.keys(normalized));
  for (const [name, value] of Object.entries(normalized)) {
    const policy = classifyClaudeIdentityHeader(name);
    if (degraded && capturedHeaders[name]?.policy === "identityReplay") continue;
    capturedHeaders[name] = makeHeader(name, value, policy, now, capturedHeaders[name]);
  }

  if (!degraded) {
    for (const [name, header] of Object.entries(capturedHeaders)) {
      if (observedNames.has(name)) continue;
      const missingCount = (header.missingCount || 0) + 1;
      capturedHeaders[name] = {
        ...header,
        missingCount,
        lastMissingAt: now,
        stale: missingCount >= STALE_MISSING_CAPTURE_COUNT,
      };
    }
  }

  state.identities.set(source.namespace, {
    namespace: source.namespace,
    headers: capturedHeaders,
    metadata: {
      createdAt: existing?.metadata?.createdAt || now,
      updatedAt: now,
      lastUsedAt: existing?.metadata?.lastUsedAt,
      captureCount: (existing?.metadata?.captureCount || 0) + 1,
      sourceConfidence: source.authenticated === true ? "high" : "medium",
      lastDegradedCaptureAt: degraded ? now : existing?.metadata?.lastDegradedCaptureAt,
      degradedCaptureCount: (existing?.metadata?.degradedCaptureCount || 0) + (degraded ? 1 : 0),
    },
    injectCount: existing?.injectCount || 0,
    lastInjectedAt: existing?.lastInjectedAt,
  });
  console.log(`[ClaudeIdentity] Captured ${Object.keys(normalized).length} observed headers for ${source.namespace}`);
  return true;
}

function selectIdentity(namespace) {
  const identities = getState().identities;
  if (namespace) return identities.get(namespace) || null;
  return identities.size === 1 ? identities.values().next().value : null;
}

function getIdentityStatus(identity, now) {
  const { ttlMs, staleAfterMs } = getIdentityTiming();
  const expired = now - identity.metadata.updatedAt >= ttlMs;
  const staleHeaders = Object.values(identity.headers).filter((header) =>
    header.stale === true || now - header.lastSeenAt >= staleAfterMs
  );
  return { expired, staleHeaders, staleAfterMs, ttlMs };
}

export function getClaudeIdentity(namespace) {
  // Raw replay values are never available through an unscoped lookup. This
  // prevents compatibility facades from leaking one node's identity to another.
  const identity = namespace ? selectIdentity(namespace) : null;
  if (!identity) return null;
  const { expired, staleHeaders } = getIdentityStatus(identity, Date.now());
  if (expired) return null;
  const staleNames = new Set(staleHeaders.map((header) => header.name));
  const headers = Object.fromEntries(Object.values(identity.headers)
    .filter((header) => header.policy === "identityReplay" && header.value !== undefined && !staleNames.has(header.name))
    .map((header) => [header.name, header.value]));
  return { namespace: identity.namespace, headers, metadata: { ...identity.metadata } };
}

function findHeaderKey(headers, lowerCaseName) {
  return Object.keys(headers).find((name) => name.toLowerCase() === lowerCaseName);
}

function mergeBetaValues(first = "", second = "") {
  return [...new Set(`${first},${second}`.split(",").map((value) => value.trim()).filter(Boolean))].join(",");
}

export function mergeClaudeIdentityHeaders(baseHeaders, { namespace, now: requestedNow } = {}) {
  const headers = { ...(baseHeaders || {}) };
  const identity = selectIdentity(namespace);
  if (!identity) return { headers, injected: false, skipped: "no-identity" };
  const now = getNow(requestedNow);
  const { expired, staleHeaders } = getIdentityStatus(identity, now);
  if (expired) return { headers, injected: false, skipped: "expired" };
  const staleNames = new Set(staleHeaders.map((header) => header.name));
  let injectedHeaderCount = 0;

  for (const header of Object.values(identity.headers)) {
    if (header.policy !== "identityReplay" || header.value === undefined || staleNames.has(header.name)) continue;
    const existingKey = findHeaderKey(headers, header.name);
    if (header.name === "anthropic-beta") {
      const merged = mergeBetaValues(existingKey ? headers[existingKey] : "", header.value);
      if (existingKey) delete headers[existingKey];
      headers[header.name] = merged;
      injectedHeaderCount += 1;
      continue;
    }
    if (existingKey) delete headers[existingKey];
    headers[header.name] = header.value;
    injectedHeaderCount += 1;
  }

  if (injectedHeaderCount === 0) return { headers, injected: false, skipped: "all-replay-headers-stale" };
  identity.injectCount += 1;
  identity.lastInjectedAt = now;
  identity.metadata.lastUsedAt = identity.lastInjectedAt;
  return { headers, injected: true };
}

export function recordClaudeIdentityExecutorBuild({ provider, injectClaudeIdentity }) {
  getState().lastExecutorBuild = { provider: provider || null, injectClaudeIdentity: injectClaudeIdentity === true, at: Date.now() };
}

function summarizeIdentity(identity, now = Date.now()) {
  const headers = Object.values(identity.headers);
  const { expired, staleHeaders, staleAfterMs, ttlMs } = getIdentityStatus(identity, now);
  const staleNames = new Set(staleHeaders.map((header) => header.name));
  const byPolicy = (policy) => headers.filter((header) => header.policy === policy).length;
  return {
    hasIdentity: true,
    namespace: identity.namespace,
    status: expired ? "expired" : (staleHeaders.length ? "stale" : "healthy"),
    headerCount: headers.length,
    replayableHeaderCount: byPolicy("identityReplay"),
    observeOnlyHeaderCount: byPolicy("observeOnly"),
    neverReplayHeaderCount: byPolicy("neverReplay") + byPolicy("sensitiveClientPreferred"),
    capturedAt: identity.metadata.createdAt,
    updatedAt: identity.metadata.updatedAt,
    lastInjectedAt: identity.lastInjectedAt,
    expired,
    staleHeaderCount: staleHeaders.length,
    ttlMs,
    staleAfterMs,
    captureCount: identity.metadata.captureCount,
    injectCount: identity.injectCount,
    sourceConfidence: identity.metadata.sourceConfidence,
    degradedCaptureCount: identity.metadata.degradedCaptureCount || 0,
    lastDegradedCaptureAt: identity.metadata.lastDegradedCaptureAt,
    headers: headers.map(({ name, policy, seenCount, changedCount, missingCount, valueHash, valueLength }) => ({
      name, policy, seenCount, changedCount, missingCount, stale: staleNames.has(name), valueHash, valueLength,
    })),
  };
}

export function getClaudeIdentityDebug(namespace, { now: requestedNow } = {}) {
  const { identities, lastExecutorBuild } = getState();
  const now = getNow(requestedNow);
  const identity = selectIdentity(namespace);
  if (identity) return { ...summarizeIdentity(identity, now), lastExecutorBuild };
  if (identities.size === 0) return { hasIdentity: false, lastExecutorBuild };
  return {
    hasIdentity: true,
    namespaceCount: identities.size,
    identities: [...identities.values()].map((item) => summarizeIdentity(item, now)),
    lastExecutorBuild,
  };
}

export function clearClaudeIdentity(namespace) {
  const identities = getState().identities;
  if (namespace) identities.delete(namespace);
  else identities.clear();
}
