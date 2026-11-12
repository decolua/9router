// Wrapper marker (FED-014): other entry points (src/instrumentation.js) check
// this to detect that the federation-aware wrapper is active. Must be set
// before anything else.
globalThis.__9ROUTER_CUSTOM_SERVER__ = true;

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const origCreate = http.createServer.bind(http);

// Per-process secret proving x-9r-real-ip was stamped below rather than sent by the client.
// A bare `next start` / `next dev` never loads this file, so it cannot produce a matching
// header even though the env var is inherited by child processes. Named like x-9r-cli-token
// so the request-detail header sanitizer redacts it too.
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

// ─── DF-9ROUTER-3: crash/boot/shutdown JSONL logging ─────────────────────
//
// A production OOM kill (SIGKILL, exit 137) cannot be caught by any signal
// handler, so the diagnostic surface this facility provides is the RECORDS
// themselves: every boot appends a `boot` record, every clean signal stop
// appends `shutdown`, every crash appends `uncaughtException` /
// `unhandledRejection`. A `boot` record with NO following record means the
// process died abnormally (OOM killer / SIGKILL) — check `dmesg` or
// `journalctl -k` for the kernel OOM entry. That boot-vs-shutdown gap is the
// entire point of this facility.
//
// ALL logging here is FAIL-OPEN: any fs error while writing the crash log is
// swallowed (with at most one console.error). The crash logger must never
// itself crash or block the process.
//
// Log location: <dataDir>/logs/crash.log, where dataDir resolves as
// process.env.DATA_DIR, else the platform default mirroring
// src/lib/dataDir.mjs (kept inline — this file is CJS and dependency-light,
// it must not import the ESM dataDir module).
function crashLogDataDir() {
  const configured = process.env.DATA_DIR;
  if (configured) return configured;
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "9router"
    );
  }
  return path.join(os.homedir(), ".9router");
}

let crashLogFile = null; // resolved lazily on first write

function crashLogWrite(record) {
  try {
    if (!crashLogFile) {
      const logsDir = path.join(crashLogDataDir(), "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      crashLogFile = path.join(logsDir, "crash.log");
    }
    fs.appendFileSync(crashLogFile, JSON.stringify(record) + "\n");
  } catch (e) {
    try {
      console.error("[crashlog] write failed:", e && e.message ? e.message : e);
    } catch {
      /* stderr itself may be broken during a crash — stay silent */
    }
  }
}

function crashLogRecord(event, extra) {
  return Object.assign(
    { ts: new Date().toISOString(), event, pid: process.pid },
    extra
  );
}

// Boot record. Written only on the real boot path (require.main === module)
// — requiring this module (unit-test children) must not append boot lines.
function crashLogBoot() {
  crashLogWrite(
    crashLogRecord("boot", {
      argv: path.basename(process.argv[1] || ""),
      dataDir: crashLogDataDir(),
    })
  );
}

// Crash handlers: log the failure, mirror it to console.error, then exit
// non-zero — Node's default die behavior is preserved (an installed handler
// suppresses the default, so we exit explicitly; the process must NOT be
// kept alive after an uncaught exception).
process.on("uncaughtException", (err) => {
  crashLogWrite(
    crashLogRecord("uncaughtException", {
      name: err && err.name ? err.name : "Error",
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack) : String(err),
    })
  );
  console.error(err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : null;
  crashLogWrite(
    crashLogRecord("unhandledRejection", {
      name: err ? err.name : "NonError",
      message: err ? err.message : String(reason),
      stack: err ? String(err.stack) : String(reason),
    })
  );
  console.error(reason);
  process.exit(1);
});

// Shutdown records: a clean SIGINT/SIGTERM stop leaves a `shutdown` line.
// Registered before (and additive to) the background-token-refresh
// process.once stoppers below — the deferred exit lets that cleanup run
// first. SIGKILL (exit 137, the OOM kill) can never reach a handler — see
// the facility comment above for why the missing-record reading is the
// diagnostic.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    crashLogWrite(crashLogRecord("shutdown", { signal: sig }));
    setImmediate(() => process.exit(0));
  });
}

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
//   - shouldTagDegraded/tagDegraded (FED-005): while DEGRADED, dashboard
//     READ responses that fall through to local handlers carry
//     X-Federation-State: degraded (spec §3.5). The decision + header
//     mutation live in headers.js (testable); this file only calls them.
let failoverFns = null;
let failoverLoadPromise = null;
function loadFederationFailover() {
  if (!failoverLoadPromise) {
    const failoverPath = path.join(__dirname, "src", "lib", "federation", "failover.js");
    const queuePath = path.join(__dirname, "src", "lib", "federation", "queue.js");
    const proxyPath = path.join(__dirname, "src", "lib", "federation", "proxy.js");
    const headersPath = path.join(__dirname, "src", "lib", "federation", "headers.js");
    failoverLoadPromise = Promise.all([
      import(pathToFileURL(failoverPath).href),
      import(pathToFileURL(queuePath).href),
      import(pathToFileURL(proxyPath).href),
      import(pathToFileURL(headersPath).href),
    ])
      .then(([f, q, p, h]) => {
        failoverFns = {
          flipToDegraded: f.flipToDegraded,
          handleDegradedWrite: q.handleDegradedWrite,
          isMutatingDashboardApi: p.isMutatingDashboardApi,
          isDashboardApiPath: p.isDashboardApiPath,
          shouldTagDegraded: h.shouldTagDegraded,
          tagDegraded: h.tagDegraded,
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

// FED-005: while the edge is DEGRADED, responses that fall through to the
// local handler (dashboard reads, /v1 from the replica) carry
// X-Federation-State: degraded (spec §3.5). Thin: hooks writeHead/setHeader
// once so the header lands on whatever the local handler produces. The
// decision (state === 'degraded') is made by the caller; the header mutation
// lives in headers.js (testable). Never overwrites an existing value — the
// queued-write path (queue.js) sets its own headers first.
function tagDegradedResponse(res) {
  if (!res || res.__fedTagged) return;
  res.__fedTagged = true;
  const origWriteHead = res.writeHead.bind(res);
  const origSetHeader = res.setHeader.bind(res);
  res.writeHead = (statusCode, statusMessage, headers) => {
    // Normalize the 2-arg form writeHead(status, headersObj).
    if (typeof statusMessage === "object" && statusMessage !== null) {
      headers = statusMessage;
      statusMessage = undefined;
    }
    if (headers && typeof headers === "object" && failoverFns) {
      failoverFns.tagDegraded(headers);
    }
    if (statusMessage === undefined) return origWriteHead(statusCode, headers);
    return origWriteHead(statusCode, statusMessage, headers);
  };
  res.setHeader = (name, value) => {
    if (failoverFns && !res.getHeader("x-federation-state")) {
      origSetHeader.call(res, "X-Federation-State", "degraded");
    }
    return origSetHeader(name, value);
  };
}

// Federation loop starter (FED-013): start the replication (edgeClient) and
// failover (heartbeat) loops when the server listens, gated on
// FEDERATION_MODE=edge. Before FED-013 only the e2e harness started them, so
// real edge deployments never replicated and never recovered from a central
// outage. Lazily imported like the loaders above — fail-open when
// src/lib/federation is absent from the deployment image (never crash the
// listening server). Interval/threshold defaults come from the federation
// config (FEDERATION_SYNC_INTERVAL_MS / FEDERATION_HEARTBEAT_INTERVAL_MS /
// FEDERATION_OUTAGE_THRESHOLD_MS); the starter module guards against
// double-start itself, so this flag is just a cheap short-circuit.
let federationLoopsStarted = false;
function startFederationLoopsFromCustomServer() {
  if (federationLoopsStarted) return;
  const isEdgeMode = String(process.env.FEDERATION_MODE || "").trim().toLowerCase() === "edge";
  if (!isEdgeMode) return; // standalone/central: zero drift
  federationLoopsStarted = true;
  const modPath = path.join(__dirname, "src", "lib", "federation", "startLoops.js");
  import(pathToFileURL(modPath).href)
    .then((m) => m.startFederationLoops())
    .catch((e) => {
      console.error("[federation] loop starter load failed:", e && e.message ? e.message : e);
      federationLoopsStarted = false; // allow a later retry
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
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
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
    // FED-005: the edge state is read once per request and drives both the
    // DEGRADED write-queue intercept (FED-004) and the DEGRADED read-header
    // tag. Resolves to null when not edge mode / failover not loaded.
    const edgeStatePromise = failoverFns && isEdgeMode ? getEdgeStateFromDb() : Promise.resolve(null);
    const degradedIntercept = edgeStatePromise.then((state) => {
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
    });

    return degradedIntercept.then((handled) => {
      if (handled) return;
      return edgeStatePromise.then((state) => {
        // FED-005: while DEGRADED, dashboard API reads that fall through to
        // the local replica carry X-Federation-State: degraded (spec §3.5).
        // Decision here (state + path); the header mutation is a thin
        // writeHead/setHeader hook (tagDegradedResponse) that never
        // overwrites an existing value (the queued-write path sets its own).
        if (failoverFns && isEdgeMode && failoverFns.shouldTagDegraded(state) && failoverFns.isDashboardApiPath(req.url)) {
          tagDegradedResponse(res);
        }
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
    });
  };
  const server = origCreate(...rest, wrapped);
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
    loadFederationProxy();
    loadFederationFailover();
    startFederationLoopsFromCustomServer();
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

// FED-014: locate the Next standalone server entry. Supports BOTH layouts:
//   - Docker standalone layout: custom-server.js sits next to server.js
//     (the Docker CMD `node custom-server.js` runs from the standalone dir).
//   - Repo layout after `npm run build` (+ postbuild asset copy):
//     .next/standalone/server.js, while custom-server.js stays at repo root.
// Returns the resolved absolute path, or null when neither exists. Pure and
// exported so tests can exercise resolution without booting the server.
function resolveStandaloneServerPath({ dir } = {}) {
  const base = dir || __dirname;
  const dockerLayout = path.join(base, "server.js");
  if (fs.existsSync(dockerLayout)) return dockerLayout;
  const repoLayout = path.join(base, ".next", "standalone", "server.js");
  if (fs.existsSync(repoLayout)) return repoLayout;
  return null;
}

// FED-015: the federation runtime modules an edge needs at boot. Next file
// tracing does not follow custom-server.js's dynamic imports, so the
// standalone Docker image ships NONE of these unless the Dockerfile copies
// them explicitly (Dockerfile.federation ships the whole src/; the plain
// Dockerfile must copy src/lib/federation + src/lib/db + src/lib/dataDir.mjs).
// An edge without them fails open — requests fall through to local handlers
// with only a console.error, i.e. FEDERATION_MODE=edge is silently inert.
// Returns the missing module paths (empty when the runtime is complete or
// the mode is not edge — standalone/central boots are never affected).
function missingFederationRuntimeModules({ dir, mode } = {}) {
  const base = dir || __dirname;
  const resolvedMode =
    mode === undefined ? process.env.FEDERATION_MODE || "" : String(mode);
  const isEdgeMode = resolvedMode.trim().toLowerCase() === "edge";
  if (!isEdgeMode) return [];
  return [
    path.join(base, "src", "lib", "federation", "proxy.js"),
    path.join(base, "src", "lib", "federation", "startLoops.js"),
    path.join(base, "src", "lib", "db", "driver.js"),
    path.join(base, "src", "lib", "dataDir.mjs"),
  ].filter((p) => !fs.existsSync(p));
}

// FED-015 boot guard: an edge that cannot load the federation runtime must
// NOT boot silently inert (task AC: "either runs federation or exits with a
// clear error — never silent inert"). Loud FATAL + exit(1), mirroring the
// resolveStandaloneServerPath failure path above.
function assertFederationRuntimePresent() {
  const missing = missingFederationRuntimeModules();
  if (missing.length === 0) return;
  console.error(
    "FATAL: FEDERATION_MODE=edge but the federation runtime modules are missing:\n" +
      missing.map((p) => "  - " + p).join("\n") +
      "\nAn edge without these fails open and serves local data silently " +
      "(no proxying, no replication, no DEGRADED write-queue). Ship them in the " +
      "image (Dockerfile: COPY src/lib/federation src/lib/db src/lib/dataDir.mjs) " +
      "or run from a layout that has src/."
  );
  process.exit(1);
}

// NR-GAP-019 placeholder-secret guard: docker-compose.federation.yml ships
// change-me-* example secrets. Warn loudly at boot so a copy-paste deployment
// is never silently exposed beyond localhost. Warning-only (localhost
// quickstarts still boot); exported so spawned-child unit tests can exercise
// it with arbitrary env objects (importing this file into vitest would leak
// the http.createServer monkeypatch above).
// NR-GAP-034: a configured FEDERATION_TOKEN shorter than 16 chars is
// brute-forceable — the federation API (snapshot/delta/verify/replay) is
// gated only by this token. Treat it like a placeholder: flagged at boot, so
// federation-mode boots refuse to start (standalone keeps warning-only).
function checkPlaceholderSecrets(env = process.env) {
  const PLACEHOLDER_PREFIXES = [
    ["FEDERATION_TOKEN", "change-me"],
    ["JWT_SECRET", "change-me"],
    ["API_KEY_SECRET", "change-me"],
    ["INITIAL_PASSWORD", "change-me"],
  ];
  const flagged = PLACEHOLDER_PREFIXES.filter(([name, prefix]) =>
    String(env[name] || "").startsWith(prefix)
  ).map(([name]) => name);
  const token = String(env.FEDERATION_TOKEN || "");
  if (token.length > 0 && token.length < 16 && !flagged.includes("FEDERATION_TOKEN")) {
    flagged.push("FEDERATION_TOKEN");
  }
  return flagged;
}

module.exports = {
  resolveStandaloneServerPath,
  missingFederationRuntimeModules,
  checkPlaceholderSecrets,
};

if (require.main === module) {
  // DF-9ROUTER-3: the boot record is written even when boot fails below —
  // a boot line with no following shutdown/crash record marks an abnormal
  // death (OOM/SIGKILL) in post-mortem.
  crashLogBoot();

  const serverPath = resolveStandaloneServerPath();
  if (!serverPath) {
    console.error(
      "FATAL: cannot locate the Next standalone server (server.js). " +
        "Run `npm run build` first (produces .next/standalone/server.js), " +
        "or run from the Docker standalone layout (custom-server.js next to server.js)."
    );
    process.exit(1);
  }
  assertFederationRuntimePresent();

  const placeholderSecrets = checkPlaceholderSecrets();
  if (placeholderSecrets.length > 0) {
    // R3-02: the NR-GAP-034 too-short-FEDERATION_TOKEN branch shares the
    // NR-GAP-019 placeholder guard — give it its own message so ops can tell
    // a brute-forceable token apart from the compose example values.
    const shortToken = placeholderSecrets.includes("FEDERATION_TOKEN") &&
      (() => {
        const t = String(process.env.FEDERATION_TOKEN || "");
        return t.length > 0 && t.length < 16 && !t.startsWith("change-me");
      })();
    const federationMode = process.env.FEDERATION_MODE;
    if (federationMode) {
      // NR-GAP-019 (2nd reopen): a federation instance (compose central/edge)
      // with the example placeholder secrets is trivially compromised if
      // reachable beyond localhost — refuse to boot instead of warning
      // (container logs are invisible to a `docker compose up -d` deployer).
      // Standalone (FEDERATION_MODE unset) keeps the warning-only path below.
      console.error(
        shortToken
          ? "[security] FATAL: FEDERATION_TOKEN too short — " +
              "FEDERATION_TOKEN must be at least 16 characters (it is the only " +
              "gate on the federation snapshot/delta/verify/replay API). " +
              "Refusing to boot in FEDERATION_MODE=" +
              federationMode +
              ". Generate a long random token first (docs/FEDERATION.md §6.1)."
          : "[security] FATAL: placeholder secrets still in use (" +
              placeholderSecrets.join(", ") +
              " are set to the docker-compose.federation.yml example values) — " +
              "refusing to boot in FEDERATION_MODE=" +
              federationMode +
              ". Replace them with real secrets first (docs/FEDERATION.md §6.1); " +
              "an instance with known secrets is trivially compromised beyond localhost."
      );
      process.exit(1);
    }
    console.error(
      shortToken
        ? "[security] WARNING: FEDERATION_TOKEN too short — must be at least " +
            "16 characters (it is the only gate on the federation API). Fine " +
            "for localhost-only testing, but this instance is NOT safe to " +
            "expose beyond localhost. Generate a long random token — see " +
            "docs/FEDERATION.md §6.1."
        : "[security] WARNING: placeholder secrets still in use (" +
            placeholderSecrets.join(", ") +
            " are set to the docker-compose.federation.yml example values). " +
            "Fine for localhost-only testing, but this instance is NOT safe to " +
            "expose beyond localhost. Replace them before any real deployment " +
            "— see docs/FEDERATION.md §6.1."
    );
  }

  require(serverPath);

  // TEST-ONLY hook (DF-9ROUTER-3): lets spawned-child tests exercise the
  // crash-log paths synchronously. NINEROUTER_CRASH_TEST=throw raises an
  // uncaught error after boot, =reject creates an unhandled rejection, and
  // =sigterm sends SIGTERM to this process. Never set this in production.
  const crashTest = process.env.NINEROUTER_CRASH_TEST;
  if (crashTest === "throw") {
    setImmediate(() => {
      throw new Error("NINEROUTER_CRASH_TEST throw");
    });
  } else if (crashTest === "reject") {
    Promise.reject(new Error("NINEROUTER_CRASH_TEST reject"));
  } else if (crashTest === "sigterm") {
    process.kill(process.pid, "SIGTERM");
  }
}
