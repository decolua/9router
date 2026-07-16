const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

const PROTECTED_HEADERS = new Set(["authorization", "x-api-key", "content-length", "host", "content-type", "accept"]);

// Next can evaluate the same source file in separate server module graphs.
// Keep the process-local identity on globalThis so capture, executor, and
// diagnostic routes observe the same state.
const STATE_KEY = Symbol.for("9router.claudeIdentityManager.state");

function getState() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = { identity: null, lastExecutorBuild: null };
  return globalThis[STATE_KEY];
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return null;
  const normalized = {};
  const entries = typeof headers.entries === "function" ? headers.entries() : Object.entries(headers);
  for (const [name, value] of entries) {
    if (value === undefined || value === null) continue;
    normalized[String(name).toLowerCase()] = String(value);
  }
  return normalized;
}

export function isClaudeCodeClient(headers) {
  const normalized = normalizeHeaders(headers);
  if (!normalized) return false;
  const userAgent = (normalized["user-agent"] || "").toLowerCase();
  return userAgent.includes("claude-cli") || userAgent.includes("claude-code") || (normalized["x-app"] || "").toLowerCase() === "cli";
}

export function captureClaudeIdentity(headers, source = {}) {
  const normalized = normalizeHeaders(headers);
  if (!normalized || !isClaudeCodeClient(normalized)) return false;

  const captured = {};
  for (const [name, value] of Object.entries(normalized)) {
    if (!HOP_BY_HOP_HEADERS.has(name)) captured[name] = value;
  }
  if (!Object.keys(captured).length) return false;

  const state = getState();
  const now = Date.now();
  state.identity = {
    headers: captured,
    createdAt: state.identity?.createdAt || now,
    updatedAt: now,
    source: {
      userAgent: normalized["user-agent"],
      xApp: normalized["x-app"],
      path: source.path,
    },
    captureCount: (state.identity?.captureCount || 0) + 1,
    injectCount: state.identity?.injectCount || 0,
    lastInjectedAt: state.identity?.lastInjectedAt,
  };
  console.log(`[ClaudeIdentity] Captured ${Object.keys(captured).length} headers from Claude Code client`);
  return true;
}

export function getClaudeIdentity() {
  const { identity } = getState();
  return identity ? { ...identity, headers: { ...identity.headers }, source: { ...identity.source } } : null;
}

function findHeaderKey(headers, lowerCaseName) {
  return Object.keys(headers).find((name) => name.toLowerCase() === lowerCaseName);
}

function mergeBetaValues(first = "", second = "") {
  return [...new Set(`${first},${second}`.split(",").map((value) => value.trim()).filter(Boolean))].join(",");
}

export function mergeClaudeIdentityHeaders(baseHeaders, { preserveAuth = true } = {}) {
  const headers = { ...(baseHeaders || {}) };
  const { identity } = getState();
  if (!identity) return { headers, injected: false, skipped: "no-identity" };

  for (const [name, value] of Object.entries(identity.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name) || (preserveAuth && PROTECTED_HEADERS.has(name))) continue;
    const existingKey = findHeaderKey(headers, name);
    if (name === "anthropic-beta") {
      const merged = mergeBetaValues(existingKey ? headers[existingKey] : "", value);
      if (existingKey) delete headers[existingKey];
      headers[name] = merged;
      continue;
    }
    if (existingKey) delete headers[existingKey];
    headers[name] = value;
  }

  identity.injectCount += 1;
  identity.lastInjectedAt = Date.now();
  return { headers, injected: true };
}

export function recordClaudeIdentityExecutorBuild({ provider, injectClaudeIdentity }) {
  getState().lastExecutorBuild = {
    provider: provider || null,
    injectClaudeIdentity: injectClaudeIdentity === true,
    at: Date.now(),
  };
}

export function getClaudeIdentityDebug() {
  const { identity, lastExecutorBuild } = getState();
  if (!identity) return { hasIdentity: false, lastExecutorBuild };
  return {
    hasIdentity: true,
    headerCount: Object.keys(identity.headers).length,
    headerNames: Object.keys(identity.headers).sort(),
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    captureCount: identity.captureCount,
    injectCount: identity.injectCount,
    lastInjectedAt: identity.lastInjectedAt,
    source: { ...identity.source },
    lastExecutorBuild,
  };
}

export function clearClaudeIdentity() {
  getState().identity = null;
}
