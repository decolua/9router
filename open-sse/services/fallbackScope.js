export const FALLBACK_SCOPE_ACCOUNT = "account";
export const FALLBACK_SCOPE_REQUEST = "request";

export function normalizeFallbackScope(scope) {
  return scope === FALLBACK_SCOPE_REQUEST ? FALLBACK_SCOPE_REQUEST : FALLBACK_SCOPE_ACCOUNT;
}

export function isRequestScopedFallback(scope) {
  return normalizeFallbackScope(scope) === FALLBACK_SCOPE_REQUEST;
}
