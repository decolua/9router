import {
  CODEX_NATIVE_BLOCKED_REQUEST_HEADERS,
  CODEX_NATIVE_SAFE_REQUEST_HEADERS,
  CODEX_NATIVE_SAFE_REQUEST_PREFIXES,
  CODEX_NATIVE_SAFE_RESPONSE_HEADERS,
  CODEX_NATIVE_SAFE_RESPONSE_PREFIXES,
} from "open-sse/config/codexNative.js";

const blocked = new Set(CODEX_NATIVE_BLOCKED_REQUEST_HEADERS);
const safeRequest = new Set(CODEX_NATIVE_SAFE_REQUEST_HEADERS);
const safeResponse = new Set(CODEX_NATIVE_SAFE_RESPONSE_HEADERS);

function entries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === "function") return [...headers.entries()];
  return Object.entries(headers);
}

function hasPrefix(name, prefixes) {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

export function sanitizeCodexNativeRequestHeaders(clientHeaders, credentials) {
  const result = new Headers();
  for (const [rawName, rawValue] of entries(clientHeaders)) {
    const name = String(rawName).toLowerCase();
    if (blocked.has(name)) continue;
    if (!safeRequest.has(name) && !hasPrefix(name, CODEX_NATIVE_SAFE_REQUEST_PREFIXES)) continue;
    if (rawValue != null) result.set(name, String(rawValue));
  }

  result.set("authorization", `Bearer ${credentials.accessToken}`);
  const accountId = credentials?.providerSpecificData?.workspaceId
    || credentials?.providerSpecificData?.chatgptAccountId
    || credentials?.providerSpecificData?.accountId;
  if (accountId) result.set("chatgpt-account-id", accountId);
  if (!result.has("originator")) result.set("originator", "codex_cli_rs");
  return result;
}

export function sanitizeCodexNativeResponseHeaders(upstreamHeaders) {
  const result = new Headers();
  for (const [rawName, rawValue] of entries(upstreamHeaders)) {
    const name = String(rawName).toLowerCase();
    if (!safeResponse.has(name) && !hasPrefix(name, CODEX_NATIVE_SAFE_RESPONSE_PREFIXES)) continue;
    if (rawValue != null) result.append(name, String(rawValue));
  }
  return result;
}

export function headersToObject(headers) {
  return Object.fromEntries(entries(headers).map(([name, value]) => [
    String(name).toLowerCase(),
    String(value),
  ]));
}
