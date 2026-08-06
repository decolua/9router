// OAuth token keep-alive: refreshes access tokens shortly before they expire so an idle
// connection never needs re-authorization.
//
// Without this, refresh only happens on the request path (getProviderCredentials → the
// executor's needsRefresh check) or when someone opens the usage page. A provider with a
// short-lived token — xai/grok-cli issues 6h tokens — therefore expires whenever traffic
// goes elsewhere for a few hours, and recovery then depends on the refresh token still
// being accepted much later. Providers that rotate refresh tokens can drop the account
// entirely, which reads to the user as "I have to re-authorize every day".
//
// The tick is cheap: refreshAndUpdateCredentials() no-ops unless the executor says the
// token is inside its refresh window, so a healthy install makes zero upstream calls.
import "open-sse/index.js";

import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { TOKEN_KEEPALIVE_CONFIG } from "@/shared/constants/config";

const C = TOKEN_KEEPALIVE_CONFIG;

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__tokenKeepAlive ??= {
  interval: null,
  running: false,
  failureCache: {},
});

function isRefreshable(connection) {
  return connection?.authType === "oauth" && Boolean(connection.refreshToken);
}

function shouldSkipAfterFailure(state, connectionId, nowMs = Date.now()) {
  const failedAt = state.failureCache[connectionId];
  return Boolean(failedAt) && nowMs - failedAt < C.failureCooldownMs;
}

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

function describe(connection) {
  const name = connection.displayName || connection.name || connection.email || connection.id.slice(0, 8);
  return `${connection.provider}:${name}`;
}

// A failed refresh is the one thing the user must act on, so record it where the dashboard
// already looks. Deliberately does not touch modelLock_* — the request path owns cooldowns.
async function recordFailure(deps, connection, reason, state) {
  state.failureCache[connection.id] = Date.now();
  try {
    await deps.updateProviderConnection(connection.id, {
      lastError: `Token refresh failed: ${String(reason).slice(0, 160)}`,
      lastErrorAt: new Date().toISOString(),
    });
  } catch {
    /* the console warning below is enough; never let bookkeeping break the tick */
  }
  console.warn(`[KeepAlive] ${describe(connection)}: refresh failed: ${reason}`);
}

export async function keepConnectionAlive(connection, deps = createDefaultDeps(), state = g, force = false) {
  if (!isRefreshable(connection)) return { skipped: "not-refreshable" };
  if (shouldSkipAfterFailure(state, connection.id)) return { skipped: "failure-cooldown" };

  const proxyCfg = await deps.resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = buildProxyOptions(proxyCfg);

  let result;
  try {
    result = await deps.refreshAndUpdateCredentials(connection, force, proxyOptions);
  } catch (e) {
    await recordFailure(deps, connection, e.message, state);
    return { failed: true };
  }

  // refreshAndUpdateCredentials reports refreshFailed when the provider rejected the
  // refresh but a (stale) access token is still on file. That case used to be silent.
  if (result?.refreshFailed) {
    await recordFailure(deps, connection, "provider rejected the refresh token", state);
    return { failed: true };
  }

  if (result?.refreshed) {
    delete state.failureCache[connection.id];
    console.log(`[KeepAlive] ${describe(connection)}: token refreshed (expires ${result.connection.expiresAt})`);
    return { refreshed: true };
  }

  return { skipped: "not-due" };
}

function createDefaultDeps() {
  return {
    getProviderConnections,
    updateProviderConnection,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
  };
}

export async function runTokenKeepAliveTick(deps = createDefaultDeps(), state = g) {
  if (state.running) return;
  state.running = true;
  try {
    const connections = await deps.getProviderConnections({ isActive: true });
    for (const connection of connections.filter(isRefreshable)) {
      try {
        await keepConnectionAlive(connection, deps, state);
      } catch (e) {
        console.warn(`[KeepAlive] ${describe(connection)}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn("[KeepAlive] tick error:", e.message);
  } finally {
    state.running = false;
  }
}

export function startTokenKeepAlive() {
  if (g.interval) return;
  console.log("[KeepAlive] scheduler started");
  runTokenKeepAliveTick().catch(() => {});
  g.interval = setInterval(() => { runTokenKeepAliveTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopTokenKeepAlive() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[KeepAlive] scheduler stopped");
}
