// Client identity profiles for OpenAI/Anthropic-compatible provider nodes.
// Pure data + parsing only: the dashboard imports this file, so it must not pull
// in server-only modules. Header values for each preset live in
// shared/clientIdentityHeaders.js.

export const DEFAULT_CLIENT_IDENTITY_PROFILE = "default";
export const CUSTOM_CLIENT_IDENTITY_PROFILE = "custom";

export const CLIENT_IDENTITY_PROFILE_OPTIONS = [
  { value: DEFAULT_CLIENT_IDENTITY_PROFILE, label: "Default" },
  { value: "claude-cli", label: "Claude CLI" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "openclaw", label: "OpenClaw" },
  { value: CUSTOM_CLIENT_IDENTITY_PROFILE, label: "Custom Headers" },
];

const PROFILE_IDS = new Set(CLIENT_IDENTITY_PROFILE_OPTIONS.map((o) => o.value));

// Credentials always come from the connection; a profile can never replace them.
const BLOCKED_HEADER_NAMES = new Set(["authorization", "x-api-key", "api-key", "cookie"]);

export function isBlockedClientIdentityHeader(name) {
  return BLOCKED_HEADER_NAMES.has(String(name || "").trim().toLowerCase());
}

export function normalizeClientIdentityProfile(profile) {
  return PROFILE_IDS.has(profile) ? profile : DEFAULT_CLIENT_IDENTITY_PROFILE;
}

function sanitizeHeaderEntries(entries) {
  const headers = {};
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || "").trim();
    if (!name || isBlockedClientIdentityHeader(name) || rawValue == null) continue;
    const value = String(rawValue).trim();
    if (value) headers[name] = value;
  }
  return headers;
}

// Custom headers: an object, a JSON object string, or "Header: value" lines
// (blank lines and "#" comments ignored). Returns { headers, error }.
export function parseClientIdentityHeaders(input) {
  if (!input) return { headers: {} };
  if (typeof input === "object") {
    if (Array.isArray(input)) return { headers: {}, error: "Custom headers must be an object." };
    return { headers: sanitizeHeaderEntries(Object.entries(input)) };
  }

  const text = String(input).trim();
  if (!text) return { headers: {} };

  if (text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { headers: {}, error: "Custom headers must be valid JSON or Header: value lines." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { headers: {}, error: "Custom headers must be a JSON object." };
    }
    return { headers: sanitizeHeaderEntries(Object.entries(parsed)) };
  }

  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep <= 0) return { headers: {}, error: "Each custom header line must use Header: value." };
    entries.push([line.slice(0, sep), line.slice(sep + 1)]);
  }
  return { headers: sanitizeHeaderEntries(entries) };
}

// Shape stored on the node and copied into each connection's providerSpecificData.
export function normalizeClientIdentityData(data = {}) {
  const clientIdentityProfile = normalizeClientIdentityProfile(data.clientIdentityProfile);
  if (clientIdentityProfile !== CUSTOM_CLIENT_IDENTITY_PROFILE) {
    return { clientIdentityProfile, clientIdentityHeaders: {} };
  }
  const { headers, error } = parseClientIdentityHeaders(data.clientIdentityHeaders);
  return { clientIdentityProfile, clientIdentityHeaders: headers, ...(error ? { error } : {}) };
}
