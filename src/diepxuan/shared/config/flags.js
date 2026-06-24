function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalized)) return false;
  return fallback;
}

// Master switch for the DiepXuan fork extension layer.
// When false (default true), all DiepXuan hooks should act as a no-op so the
// base 9Router behaviour is restored.
export function isDiepXuanEnabled() {
  return parseBool(process.env.DIEPXUAN_ENABLED, true);
}

// Conservative mode: only allow DiepXuan hooks that are considered safe
// (read-only helpers, no DB writes, no provider override). Other hooks should
// fall back to the base behaviour.
export function isDiepXuanSafeMode() {
  return parseBool(process.env.DIEPXUAN_SAFE_MODE, false);
}

export const DIE_PXUAN_FLAGS = {
  isDiepXuanEnabled,
  isDiepXuanSafeMode,
};