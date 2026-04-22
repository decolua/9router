// Synchronous RTK toggle cache. Updated by /api/settings PATCH handler
// and initialized from DB on server boot.
let enabled = false;

export function setRtkEnabled(value) {
  enabled = Boolean(value);
}

export function isRtkEnabled() {
  return enabled;
}
