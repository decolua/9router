const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const origCreate = http.createServer.bind(http);

// Per-process secret proving x-9r-real-ip was stamped below rather than sent by the client.
// A bare `next start` / `next dev` never loads this file, so it cannot produce a matching
// header even though the env var is inherited by child processes. Named like x-9r-cli-token
// so the request-detail header sanitizer redacts it too.
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
process.env.NEXT_MANUAL_SIG_HANDLE = "1";
const shutdownCoord = (global.__shutdownCoordinator ??= {
  installed: false,
  started: false,
  shuttingDown: false,
  inflightCount: 0,
  servers: new Set(),
  inflightWaiters: new Set(),
});
let backgroundRefreshStarted = false;

function startBackgroundTokenRefreshFromCustomServer() {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  // Prefer source path (repo / standalone that still has src). Fail-open if missing
  // — initializeApp also starts the same scheduler when the Next app boots.
  const modPath = path.join(__dirname, "src", "sse", "services", "backgroundTokenRefresh.js");
  import(pathToFileURL(modPath).href)
    .then((m) => {
      if (m && typeof m.startBackgroundTokenRefresh === "function") {
        m.startBackgroundTokenRefresh();
      }
    })
    .catch((e) => {
      console.warn("Custom server failed to import backgroundTokenRefresh:", e && e.message ? e.message : e);
    });
}

// CORS headers injected on every response — allows browser/Electron clients
// on any origin (Tailscale, local network, etc.) to call the OpenAI-compatible
// API without being blocked by same-origin policy.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, PATCH",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, x-api-key, x-goog-api-key, Origin, Accept, Cache-Control",
  "Access-Control-Max-Age": "86400",
};


// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const isShutting = shutdownCoord.shuttingDown || (typeof shutdownCoord.isShuttingDown === "function" && shutdownCoord.isShuttingDown());
    if (isShutting) {
      res.writeHead(503, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
      res.end(JSON.stringify({ error: "Server is shutting down" }));
      return;
    }

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

    // ── CORS preflight ────────────────────────────────────────────────
    // Browsers send OPTIONS *before* the real request, and never include
    // Authorization on preflight. Respond 204 immediately so the actual
    // POST/DELETE/etc. can proceed with the API key.
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    // ── Inject CORS on every response ─────────────────────────────────
    // Wrap writeHead so all downstream responses (including 401/403 from the
    // auth middleware) carry CORS headers; otherwise the browser surfaces a
    // genuine auth failure as an opaque network error.
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (statusCode, ...restArgs) => {
      let headers;
      if (restArgs.length && typeof restArgs[restArgs.length - 1] === "object" && !Array.isArray(restArgs[restArgs.length - 1])) {
        headers = restArgs[restArgs.length - 1];
        Object.assign(headers, CORS_HEADERS);
      } else if (restArgs.length && typeof restArgs[0] === "object" && !Array.isArray(restArgs[0])) {
        headers = restArgs[0];
        Object.assign(headers, CORS_HEADERS);
      } else {
        headers = Object.assign({}, CORS_HEADERS);
        restArgs.push(headers);
      }

      return origWriteHead(statusCode, ...restArgs);
    };

    // ── Shutdown admission ────────────────────────────────────────────
    // Register with the coordinator BEFORE invoking the handler: if shutdown
    // started between the check above and here, a request that was already
    // running would get a 503 written on top of the handler's own response
    // (ERR_HTTP_HEADERS_SENT). The promise is handed over first, resolved from
    // the handler afterwards, so admission is decided while nothing has run.
    let settleHandler;
    const handlerPromise = new Promise((resolve) => { settleHandler = resolve; });

    if (typeof shutdownCoord.trackRequest === "function") {
      const admitted = shutdownCoord.trackRequest(req, res, handlerPromise);
      if (!admitted) {
        settleHandler();
        res.writeHead(503, Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS));
        res.end(JSON.stringify({ error: "Server is shutting down" }));
        return;
      }
    }

    try {
      // settleHandler always RESOLVES: the coordinator only needs to know the
      // handler stopped working, and a rejection here would become an unhandled
      // rejection (the http server ignores what the listener returns).
      Promise.resolve(handler(req, res)).then(
        () => settleHandler(),
        (e) => { console.error("[Server] request handler error:", e?.message || e); settleHandler(); },
      );
    } catch (e) {
      console.error("[Server] request handler threw:", e?.message || e);
      settleHandler();
    }

    return handlerPromise;
  };
  const server = origCreate(...rest, wrapped);
  shutdownCoord.servers.add(server);
  if (typeof shutdownCoord.registerServer === "function") {
    shutdownCoord.registerServer(server);
  }
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
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

module.exports = {
  CORS_HEADERS,
};

if (require.main === module) {
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    require(standalone);
  } else {
    // Repo checkout has no standalone build next to us. `next start` builds its HTTP
    // server in-process, so the wrapper above still sanitizes every request.
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}
