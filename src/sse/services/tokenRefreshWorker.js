// Background OAuth token refresh worker.
//
// Why: 9Router historically only refreshed tokens reactively, when a chat
// request landed (`checkAndRefreshToken` inside `handleChat`). Idle accounts
// could pass their refresh-token TTL (Auth0 absolute expiry, AWS SSO 90-day
// idle, Google ~6 months) without ever being refreshed and end up `expired`.
//
// This worker periodically scans active connections and proactively refreshes
// any whose accessToken is within the provider-specific lead window.
//
// It reuses `checkAndRefreshToken` so DB persistence, projectId backfill, and
// in-flight dedup behave identically to the request hot-path.

import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { CONNECTION_STATUS } from "@/shared/constants/connectionStatus.js";
import { checkAndRefreshToken } from "./tokenRefresh.js";
import { isExpiredSessionOnly, shouldAttemptRefresh, shouldRefreshNow } from "./tokenRefreshWindow.js";
import * as log from "../utils/logger.js";

// Survive Next.js hot reload — store handle on globalThis like initializeApp.js
const g = globalThis.__9routerTokenRefreshWorker ??= {
  interval: null,
  ticking: false,
  startedAt: 0,
  ticks: 0,
  refreshed: 0,
  failed: 0,
};

// Scan cadence. Keep well below the smallest REFRESH_LEAD_MS entry so that
// every token gets at least one refresh attempt inside its lead window even
// when a tick is skipped (e.g. process-busy / clock jump).
const TICK_INTERVAL_MS = Number(process.env.TOKEN_REFRESH_WORKER_TICK_MS) || 60_000;

// Skip the worker entirely (e.g. CI, local dev where you don't want OAuth).
const DISABLED = process.env.TOKEN_REFRESH_WORKER_DISABLED === "1";

export { isExpiredSessionOnly, shouldAttemptRefresh, shouldRefreshNow } from "./tokenRefreshWindow.js";

async function tick() {
  if (g.ticking) return; // serialize ticks
  g.ticking = true;
  g.ticks += 1;
  try {
    const connections = await getProviderConnections({ isActive: true, authType: "oauth" });
    if (!connections.length) return;

    for (const conn of connections) {
      if (isExpiredSessionOnly(conn)) {
        await updateProviderConnection(conn.id, {
          testStatus: CONNECTION_STATUS.NEEDS_RELOGIN,
          lastError: "Session expired; re-import from chatgpt.com/api/auth/session",
          errorCode: 401,
          lastErrorAt: new Date().toISOString(),
        });
        g.failed += 1;
        log.warn(
          "TOKEN_REFRESH_WORKER",
          `Expired session-only account for ${conn.provider} (${conn.id?.slice(0, 8)}); user must re-import session`
        );
        continue;
      }

      if (!shouldAttemptRefresh(conn)) continue;

      try {
        let outcome = { didRefresh: false, needsRelogin: false, copilotRefreshed: false };
        await checkAndRefreshToken(conn.provider, {
          ...conn,
          connectionId: conn.id,
        }, {
          onOutcome: (nextOutcome) => { outcome = nextOutcome; },
        });

        if (outcome.needsRelogin) {
          g.failed += 1;
          log.warn(
            "TOKEN_REFRESH_WORKER",
            `Unrecoverable refresh for ${conn.provider} (${conn.id?.slice(0, 8)}); user must re-login`
          );
          continue;
        }

        if (outcome.didRefresh || outcome.copilotRefreshed) {
          g.refreshed += 1;
        }
      } catch (err) {
        g.failed += 1;
        log.warn(
          "TOKEN_REFRESH_WORKER",
          `Refresh failed for ${conn.provider} (${conn.id?.slice(0, 8)}): ${err?.message || err}`
        );
      }
    }
  } catch (err) {
    log.warn("TOKEN_REFRESH_WORKER", `Tick failed: ${err?.message || err}`);
  } finally {
    g.ticking = false;
  }
}

export function startTokenRefreshWorker() {
  if (DISABLED) {
    log.info("TOKEN_REFRESH_WORKER", "Disabled via TOKEN_REFRESH_WORKER_DISABLED=1");
    return;
  }
  if (g.interval) return; // already running (HMR-safe)

  g.startedAt = Date.now();
  g.interval = setInterval(() => {
    tick().catch(() => {});
  }, TICK_INTERVAL_MS);
  if (g.interval.unref) g.interval.unref();

  // Run immediately so freshly-started server doesn't wait one full tick.
  tick().catch(() => {});

  log.info(
    "TOKEN_REFRESH_WORKER",
    `Started (tick=${TICK_INTERVAL_MS}ms)`
  );
}

export function stopTokenRefreshWorker() {
  if (g.interval) {
    clearInterval(g.interval);
    g.interval = null;
  }
}

export function getTokenRefreshWorkerStatus() {
  return {
    running: !!g.interval,
    startedAt: g.startedAt,
    ticks: g.ticks,
    refreshed: g.refreshed,
    failed: g.failed,
    tickIntervalMs: TICK_INTERVAL_MS,
  };
}
