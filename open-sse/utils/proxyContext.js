import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped proxy configuration.
 *
 * Chat passes `proxyOptions` explicitly (chatCore -> executor -> proxyAwareFetch).
 * Media (image / tts / stt / embeddings / video / search / fetch) and MCP reach
 * the network through dozens of provider adapters that call bare `fetch`, so the
 * resolved pool has to travel with the request instead of with every call site.
 * AsyncLocalStorage keeps that ambient value isolated per in-flight request.
 */
const proxyContext = new AsyncLocalStorage();

/**
 * Canonical proxyOptions shape — the ONLY place the connection proxy fields are
 * mapped. `chatCore` and every media/MCP wrapper build their options here so the
 * six fields cannot drift apart.
 */
export function buildProxyOptions(credentials) {
  const data = credentials?.providerSpecificData || {};
  return {
    connectionProxyEnabled: data.connectionProxyEnabled === true,
    connectionProxyUrl: data.connectionProxyUrl || "",
    connectionNoProxy: data.connectionNoProxy || "",
    vercelRelayUrl: data.vercelRelayUrl || "",
    proxyPoolId: data.connectionProxyPoolId || null,
    strictProxy: data.strictProxy === true,
  };
}

/**
 * Run `fn` with `proxyOptions` visible to any `proxyAwareFetch` (or patched
 * global `fetch`) awaited inside it. A null/undefined config keeps the current
 * scope untouched, so "no proxy" stays a no-op.
 */
export function runWithProxyOptions(proxyOptions, fn) {
  if (!proxyOptions) return fn();
  return proxyContext.run(proxyOptions, fn);
}

export function getProxyOptionsFromContext() {
  return proxyContext.getStore() || null;
}

/**
 * Each Next.js route bundle loads its own module graph, so the global fetch
 * patch in `proxyFetch.js` is only guaranteed to be installed once something in
 * *this* graph imported it. Media/MCP routes must therefore pull it in
 * explicitly before running their request.
 */
export async function ensureProxyFetchPatched() {
  await import("./proxyFetch.js");
}
