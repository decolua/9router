import { CLAUDE_CLI_SPOOF_HEADERS } from "../providers/shared.js";

export const CLIENT_IDENTITY_PROFILES = {
  default: {
    label: "Default",
    headers: {},
  },
  "claude-cli": {
    label: "Claude CLI",
    headers: CLAUDE_CLI_SPOOF_HEADERS,
  },
  "codex-cli": {
    label: "Codex CLI",
    headers: {
      originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/0.136.0",
    },
  },
  openclaw: {
    label: "OpenClaw",
    headers: {
      "User-Agent": "openclaw/2026.2.3",
    },
  },
  custom: {
    label: "Custom",
    headers: {},
  },
};

const AUTH_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "cookie",
]);

export function normalizeClientIdentityProfile(profile) {
  return CLIENT_IDENTITY_PROFILES[profile] ? profile : "default";
}

export function isBlockedClientIdentityHeader(name) {
  return AUTH_HEADER_NAMES.has(String(name || "").trim().toLowerCase());
}

function sanitizeHeaderEntries(entries) {
  const headers = {};
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || "").trim();
    if (!name || isBlockedClientIdentityHeader(name)) continue;
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    headers[name] = value;
  }
  return headers;
}

function parseHeaderLines(input) {
  const entries = [];
  for (const line of String(input || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep <= 0) continue;
    entries.push([trimmed.slice(0, sep), trimmed.slice(sep + 1)]);
  }
  return entries;
}

export function parseClientIdentityHeaders(input) {
  if (!input) return {};

  if (typeof input === "object" && !Array.isArray(input)) {
    return sanitizeHeaderEntries(Object.entries(input));
  }

  const text = String(input).trim();
  if (!text) return {};

  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return sanitizeHeaderEntries(Object.entries(parsed));
  }

  return sanitizeHeaderEntries(parseHeaderLines(text));
}

export function buildClientIdentityHeaders(identity = {}) {
  const profile = normalizeClientIdentityProfile(identity.clientIdentityProfile);
  if (profile === "custom") {
    return parseClientIdentityHeaders(identity.clientIdentityHeaders);
  }
  return { ...(CLIENT_IDENTITY_PROFILES[profile]?.headers || {}) };
}

export function mergeClientIdentityHeaders(baseHeaders = {}, identity = {}, authHeaders = {}) {
  return {
    ...(baseHeaders || {}),
    ...buildClientIdentityHeaders(identity),
    ...(authHeaders || {}),
  };
}

export function normalizeClientIdentityData(data = {}) {
  const clientIdentityProfile = normalizeClientIdentityProfile(data.clientIdentityProfile);
  return {
    clientIdentityProfile,
    clientIdentityHeaders: clientIdentityProfile === "custom"
      ? parseClientIdentityHeaders(data.clientIdentityHeaders)
      : {},
  };
}

export function hasClaudeClientIdentityHeaders(headers = {}) {
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = rawName.toLowerCase();
    const value = String(rawValue || "").toLowerCase();
    if (name === "x-app" && value === "cli") return true;
    if (name === "anthropic-dangerous-direct-browser-access") return true;
    if (name === "anthropic-beta" && value.includes("claude-code-20250219")) return true;
    if (name === "user-agent" && (value.includes("claude-cli/") || value.includes("claude-code/"))) return true;
  }
  return false;
}

export function shouldStripClaudeIdentityHeaders({ provider, baseUrl = "", clientIdentityProfile, identityHeaders = {} } = {}) {
  if (!provider?.startsWith?.("anthropic-compatible-")) return false;
  const normalizedBaseUrl = String(baseUrl || "");
  const isOfficialAnthropic = normalizedBaseUrl === "" || normalizedBaseUrl.includes("api.anthropic.com");
  if (isOfficialAnthropic) return false;

  const profile = normalizeClientIdentityProfile(clientIdentityProfile);
  if (profile === "claude-cli") return false;
  if (profile === "custom" && hasClaudeClientIdentityHeaders(identityHeaders)) return false;
  return true;
}
