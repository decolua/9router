// Runtime side of the compatible-node client identity profiles
// (profile ids + custom header parsing live in config/clientIdentity.js).
import { PROVIDERS } from "../config/providers.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "../providers/shared.js";
import {
  CUSTOM_CLIENT_IDENTITY_PROFILE,
  isBlockedClientIdentityHeader,
  normalizeClientIdentityProfile,
  parseClientIdentityHeaders,
} from "../config/clientIdentity.js";

const CODEX_HEADERS = PROVIDERS.codex?.headers || {};

const PROFILE_HEADERS = {
  "claude-cli": CLAUDE_CLI_SPOOF_HEADERS,
  "codex-cli": { originator: CODEX_HEADERS.originator, "User-Agent": CODEX_HEADERS["User-Agent"] },
  openclaw: { "User-Agent": "openclaw/2026.2.3" },
};

// Headers for the profile stored in a node/connection's providerSpecificData.
export function buildClientIdentityHeaders(identity) {
  const profile = normalizeClientIdentityProfile(identity?.clientIdentityProfile);
  if (profile === CUSTOM_CLIENT_IDENTITY_PROFILE) {
    return parseClientIdentityHeaders(identity.clientIdentityHeaders).headers;
  }
  return { ...(PROFILE_HEADERS[profile] || {}) };
}

// Overlay the identity headers on an existing header set. Names are matched
// case-insensitively so a profile replaces a default (e.g. User-Agent) instead
// of duplicating it, and credential headers are never touched.
export function applyClientIdentityHeaders(headers, identity) {
  for (const [name, value] of Object.entries(buildClientIdentityHeaders(identity))) {
    if (isBlockedClientIdentityHeader(name)) continue;
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) delete headers[key];
    }
    headers[name] = value;
  }
  return headers;
}

function hasClaudeClientIdentityHeaders(headers) {
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    const value = String(rawValue).toLowerCase();
    if (name === "x-app" && value === "cli") return true;
    if (name === "anthropic-dangerous-direct-browser-access") return true;
    if (name === "anthropic-beta" && value.includes("claude-code-20250219")) return true;
    if (name === "user-agent" && (value.includes("claude-cli/") || value.includes("claude-code/"))) return true;
  }
  return false;
}

// A node that explicitly chose a Claude identity keeps the first-party Claude
// headers that are otherwise stripped for third-party anthropic-compatible hosts.
export function keepsClaudeIdentityHeaders(identity) {
  const profile = normalizeClientIdentityProfile(identity?.clientIdentityProfile);
  if (profile === "claude-cli") return true;
  return profile === CUSTOM_CLIENT_IDENTITY_PROFILE
    && hasClaudeClientIdentityHeaders(buildClientIdentityHeaders(identity));
}
