/**
 * In-memory registry of in-flight loopback capture servers for the Kiro
 * external-idp (Microsoft Entra ID) OAuth flow.
 *
 * Each entry maps `state → { promise, cancel }`. The /authorize route adds
 * an entry when it spawns the loopback listener; the /exchange route
 * awaits the promise after the user submits the form; the /authorize GET
 * polls to learn capture status.
 *
 * NOTE: this store lives in the Next.js process. If 9router runs as multiple
 * workers behind a load balancer, swap this for a shared store (Redis,
 * Postgres) before relying on the polling-based capture flow in production.
 *
 * The Vercel/standalone deployments of 9router run as a single process, so
 * the in-memory map is sufficient.
 */

const globalKey = Symbol.for("9router.kiro.externalIdp.captures");

function getStore() {
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new Map();
  }
  return globalThis[globalKey];
}

export function listActiveCaptures() {
  return getStore();
}

export function getActiveCapture(state) {
  return getStore().get(state);
}

export function dropActiveCapture(state) {
  return getStore().delete(state);
}