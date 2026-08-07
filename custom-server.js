const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const origCreate = http.createServer.bind(http);

let backgroundRefreshStarted = false;

// Federation edge proxy (FED-003): lazily loaded so standalone/central boots
// never import federation modules (zero drift). In the Docker standalone
// image src/lib/federation may be absent (Next file tracing does not follow
// dynamic imports) — the load fails open and requests fall through to local
// handlers, exactly like the background-token-refresh import above.
let proxyRequestFn = null;
let proxyLoadPromise = null;
function loadFederationProxy() {
  if (!proxyLoadPromise) {
    const modPath = path.join(__dirname, "src", "lib", "federation", "proxy.js");
    proxyLoadPromise = import(pathToFileURL(modPath).href)
      .then((m) => {
        proxyRequestFn = m.proxyRequest;
      })
      .catch((e) => {
        console.error("[federation] proxy module load failed:", e && e.message ? e.message : e);
        proxyLoadPromise = null; // allow a later retry
      });
  }
  return proxyLoadPromise;
}

// Federation failover + write queue (FED-004): lazily loaded like the proxy.
//   - flipToDegraded: wired as the proxy's onUpstreamFailure hook — a
//     proxy-side 502/timeout while LINKED flips the edge to DEGRADED
//     immediately (spec §3.4).
//   - handleDegradedWrite: while DEGRADED, mutating dashboard API calls are
//     queued to pendingWrites instead of forwarded (spec §3.4), responding
//     with X-Federation-State: degraded + X-Federation-Queued-Write-Id
//     (503 when the queue is full).
//   - isMutatingDashboardApi: the DEGRADED intercept set (forward-set minus
//     /v1 — /v1 traffic is served from the local replica through the
//     unchanged chat pipeline).
let failoverFns = null;
let failoverLoadPromise = null;
function loadFederationFailover() {
  if (!failoverLoadPromise) {
    const failoverPath = path.join(__dirname, "src", "lib", "federation", "failover.js");
    const queuePath = path.join(__dirname, "src", "lib", "federation", "queue.js");
    const proxyPath = path.join(__dirname, "src", "lib", "federation", "proxy.js");
    failoverLoadPromise = Promise.all([
      import(pathToFileURL(failoverPath).href),
      import(pathToFileURL(queuePath).href),
      import(pathToFileURL(proxyPath).href),
    ])
      .then(([f, q, p]) => {
        failoverFns = {
          flipToDegraded: f.flipToDegraded,
          handleDegradedWrite: q.handleDegradedWrite,
          isMutatingDashboardApi: p.isMutatingDashboardApi,
        };
      })
      .catch((e) => {
        console.error("[federation] failover module load failed:", e && e.message ? e.message : e);
        failoverLoadPromise = null; // allow a later retry
      });
  }
  return failoverLoadPromise;
}

// Lazy DB access for the DEGRADED write-queue intercept. Returns the adapter
// (or null when unavailable — the intercept then falls through to the local
// handler instead of crashing). The driver caches its adapter globally, so
// repeated calls are cheap.
let dbAdapterPromise = null;
function getDbAdapter() {
  if (!dbAdapterPromise) {
    const driverPath = path.join(__dirname, "src", "lib", "db", "driver.js");
    dbAdapterPromise = import(pathToFileURL(driverPath).href)
      .then((m) => m.getAdapter())
      .catch((e) => {
        console.error("[federation] db driver load failed:", e && e.message ? e.message : e);
        dbAdapterPromise = null; // allow a later retry
        return null;
      });
  }
  return dbAdapterPromise;
}

// Current edge state for the DEGRADED intercept (state.js getEdgeState).
// Returns null when the DB is unavailable — the intercept then falls through
// to the proxy path (which re-reads state itself).
let stateModulePromise = null;
function getEdgeStateFromDb() {
  if (!stateModulePromise) {
    const statePath = path.join(__dirname, "src", "lib", "federation", "state.js");
    stateModulePromise = import(pathToFileURL(statePath).href)
      .then((m) => m.getEdgeState)
      .catch((e) => {
        console.error("[federation] state module load failed:", e && e.message ? e.message : e);
        stateModulePromise = null; // allow a later retry
        return null;
      });
  }
  return stateModulePromise.then((getEdgeState) => {
    if (!getEdgeState) return null;
    return getDbAdapter().then((db) => (db ? getEdgeState(db) : null));
  });
}

function startBackgroundTokenRefreshFromCustomServer() {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  // Prefer source path (repo / standalone that still has src). Fail-open if missing
  // — initializeApp also starts the same scheduler when the Next app boots.
  const modPath = path.join(__dirname, "src", "sse", "services", "backgroundTokenRefresh.js");
  import(pathToFileURL(modPath).href)
    .then((m) => {
      try {
        m.startBackgroundTokenRefresh();
      } catch (e) {
        console.error("[BackgroundTokenRefresh] start failed:", e && e.message ? e.message : e);
      }
      const stop = () => {
        try {
          m.stopBackgroundTokenRefresh();
        } catch {
          /* ignore */
        }
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((e) => {
      // Expected in published CLI standalone (src/ not on disk). App bootstrap covers it.
      if (process.env.DEBUG_BACKGROUND_TOKEN_REFRESH) {
        console.error("[BackgroundTokenRefresh] import failed:", e && e.message ? e.message : e);
      }
    });
}

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    req.headers["x-9r-real-ip"] = ip;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    // Federation edge proxy (FED-003): LINKED edges forward /v1/* + mutating
    // dashboard API to the central instance. Falls through to the local Next
    // handler in every other case (standalone, central, DEGRADED, non-forwarded
    // paths, dashboard GET reads). The IP derivation above is untouched.
    //
    // FED-004 DEGRADED intercept: while the edge is DEGRADED, mutating
    // dashboard API calls are queued to pendingWrites (spec §3.4) instead of
    // forwarded — /v1 traffic still falls through to the local replica's
    // unchanged chat pipeline. The queue logic lives in queue.js; this is a
    // thin branch only. Gated on FEDERATION_MODE=edge so standalone/central
    // requests never pay the state read (zero drift).
    const isEdgeMode = String(process.env.FEDERATION_MODE || "").trim().toLowerCase() === "edge";
    const degradedIntercept = failoverFns && isEdgeMode
      ? getEdgeStateFromDb().then((state) => {
          if (state === "degraded" && failoverFns.isMutatingDashboardApi(req.method, req.url)) {
            return getDbAdapter().then((db) => {
              if (db) {
                failoverFns.handleDegradedWrite(req, res, db);
                return true; // handled — do not fall through
              }
              return false; // DB unavailable → fall through (never crash)
            });
          }
          return false;
        })
      : Promise.resolve(false);

    return degradedIntercept.then((handled) => {
      if (handled) return;
      if (proxyRequestFn) {
        return proxyRequestFn(req, res, {
          onUpstreamFailure: () => {
            if (failoverFns) return failoverFns.flipToDegraded();
            return null;
          },
        })
          .then((proxied) => {
            if (proxied) return;
            return handler(req, res);
          })
          .catch((err) => {
            // Defensive: an unexpected proxy failure must never crash the
            // server. If nothing was written yet, fall through to the local
            // handler; otherwise close the response.
            console.error("[federation] edge proxy error:", err && err.message ? err.message : err);
            if (!res.headersSent) return handler(req, res);
            try {
              res.destroy();
            } catch {
              /* already closed */
            }
          });
      }
      return handler(req, res);
    });
  };
  const server = origCreate(...rest, wrapped);
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
    loadFederationProxy();
    loadFederationFailover();
  });
  const origEmit = server.emit;
  // JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close.
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      socket.destroy();
      return true;
    }
    const chunks = [head];
    let received = head.length;
    const serve = () => {
      // Replay the upgraded request through the existing HTTP/1.1 handler.
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.on("data", function readBody(chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        serve();
      });
      socket.resume();
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  };
  return server;
};

if (require.main === module) require("./server.js");
