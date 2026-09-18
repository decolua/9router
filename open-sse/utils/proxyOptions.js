/**
 * Single source of truth for the `proxyOptions` payload consumed by
 * `proxyAwareFetch`.
 *
 * Every core handler and every token-refresh call must go through this so a
 * connection's proxy pool applies uniformly — chat, embeddings, images,
 * TTS/STT, video and OAuth refresh alike. Building the object ad-hoc is how
 * `strictProxy` silently went missing from the chat path.
 */

/**
 * @param {object} credentials - As returned by the app's auth service
 * @returns {{connectionProxyEnabled: boolean, connectionProxyUrl: string,
 *   connectionNoProxy: string, vercelRelayUrl: string, strictProxy: boolean}}
 */
export function buildProxyOptions(credentials) {
  const data = credentials?.providerSpecificData || {};
  return {
    connectionProxyEnabled: data.connectionProxyEnabled === true,
    connectionProxyUrl: data.connectionProxyUrl || "",
    connectionNoProxy: data.connectionNoProxy || "",
    vercelRelayUrl: data.vercelRelayUrl || "",
    strictProxy: data.connectionStrictProxy === true,
  };
}

/** Strip credentials from a proxy URL before it reaches the log. */
function maskProxyUrl(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}`;
  } catch {
    return proxyUrl;
  }
}

/**
 * Emit the unified PROXY line for a request. Logs the direct-connection case
 * too: a pool that resolved to nothing used to be completely silent, which made
 * "the proxy pool isn't working" impossible to diagnose from the logs.
 */
export function logProxySelection(log, provider, model, credentials, proxyOptions) {
  const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
  const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || null;
  const prefix = `${String(provider).toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId || "none"}`;
  const strictTag = proxyOptions?.strictProxy === true ? " | strict" : "";

  if (proxyOptions?.vercelRelayUrl) {
    log?.info?.("PROXY", `${prefix} | relay=${proxyOptions.vercelRelayUrl}${strictTag}`);
  } else if (proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl) {
    log?.info?.("PROXY", `${prefix} | url=${maskProxyUrl(proxyOptions.connectionProxyUrl)}${strictTag}`);
    if (proxyOptions.connectionNoProxy) {
      log?.debug?.("PROXY", `${prefix} | no_proxy=${proxyOptions.connectionNoProxy}`);
    }
  } else if (poolId) {
    // A pool is bound to the connection but produced no usable proxy — it was
    // deleted, deactivated (a failed test flips isActive off) or has no URL.
    log?.warn?.("PROXY", `${prefix} | pool bound but unusable — sending DIRECT`);
  } else {
    log?.debug?.("PROXY", `${prefix} | direct (no proxy configured)`);
  }
}
