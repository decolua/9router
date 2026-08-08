// In-process routing metadata attached to Response objects.
// Kept in a WeakMap so it never leaks into the response headers/body sent to
// clients, yet downstream routing code (combo fallback) can read the error
// classification of a failed single-model Response.

const _meta = new WeakMap(); // Response → { errorKind, status, failFast? }

export function setRoutingMeta(response, metadata) {
  if (response && typeof response === "object") _meta.set(response, metadata);
  return response;
}

export function getRoutingMeta(response) {
  if (!response || typeof response !== "object") return null;
  return _meta.get(response) || null;
}
