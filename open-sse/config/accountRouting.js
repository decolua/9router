export const ACCOUNT_FALLBACK_MODES = Object.freeze({ STRICT: "strict", PREFER: "prefer" });
export function normalizeAccountFallbackMode(value) {
  return value === ACCOUNT_FALLBACK_MODES.PREFER ? value : ACCOUNT_FALLBACK_MODES.STRICT;
}
