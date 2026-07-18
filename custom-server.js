const http = require("http");
const path = require("path");
const fs = require("fs");

const origCreate = http.createServer.bind(http);

/**
 * Official Codex passthrough pre-handler (loaded lazily; ESM).
 * @type {null | ((req: any, res: any) => Promise<boolean>)}
 */
let tryHandleNodeRequest = null;
let prehandlerLoadPromise = null;

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath);
  if (process.platform === "win32") {
    return "file:///" + resolved.replace(/\\/g, "/");
  }
  return "file://" + resolved;
}

function loadPrehandler() {
  if (tryHandleNodeRequest) return Promise.resolve(tryHandleNodeRequest);
  if (prehandlerLoadPromise) return prehandlerLoadPromise;

  // custom-server.js may live at repo root, Docker /app, or cli/app.
  // open-sse is copied next to it (Dockerfile) or lives at repo root.
  const candidates = [
    path.join(__dirname, "open-sse", "utils", "officialCodexHttpPrehandler.js"),
    path.join(__dirname, "..", "open-sse", "utils", "officialCodexHttpPrehandler.js"),
  ];

  prehandlerLoadPromise = (async () => {
    let lastErr = null;
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const mod = await import(pathToFileUrl(file));
        if (typeof mod.tryHandleNodeRequest === "function") {
          tryHandleNodeRequest = mod.tryHandleNodeRequest;
          return tryHandleNodeRequest;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    console.warn(
      "[PASSTHROUGH] unified prehandler not loaded — Codex /v1 will use Next handlers only:",
      lastErr?.message || "module not found"
    );
    tryHandleNodeRequest = async () => false;
    return tryHandleNodeRequest;
  })();

  return prehandlerLoadPromise;
}

function stampClientIp(req) {
  const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
  const xff = req.headers["x-forwarded-for"];
  const xRealIp = req.headers["x-real-ip"];
  const viaProxy = !!(xff || xRealIp);
  const isLoopbackProxy =
    socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
  // Trust forwarding headers only when the TCP peer is a local reverse proxy.
  // Direct/public sockets remain keyed by the unspoofable peer address.
  const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
  const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
  delete req.headers["x-9r-real-ip"];
  delete req.headers["x-forwarded-for"];
  delete req.headers["x-9r-via-proxy"];
  req.headers["x-9r-real-ip"] = ip;
  if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
}

// Wrap Next (standalone or next start) HTTP server:
// 1) derive client IP from the TCP socket
// 2) Codex /v1/* official passthrough before Next routing
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);

  const wrapped = (req, res) => {
    stampClientIp(req);

    const run = async () => {
      try {
        const tryHandle = await loadPrehandler();
        const handled = await tryHandle(req, res);
        if (handled) return;
      } catch (err) {
        console.error("[PASSTHROUGH] prehandler error:", err?.message || err);
        if (res.headersSent) return;
      }
      return handler(req, res);
    };

    Promise.resolve(run()).catch((err) => {
      console.error("[PASSTHROUGH] unhandled:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  };

  return origCreate(...rest, wrapped);
};

function boot() {
  // Docker / CLI: custom-server.js sits next to Next standalone server.js
  const rootServer = path.join(__dirname, "server.js");
  if (fs.existsSync(rootServer)) {
    require(rootServer);
    return;
  }

  // Repo-root after `next build`: optional standalone server
  const standaloneServer = path.join(__dirname, ".next", "standalone", "server.js");
  if (fs.existsSync(standaloneServer)) {
    // Keep __dirname for prehandler path resolution; only change cwd for Next assets
    process.chdir(path.dirname(standaloneServer));
    require(standaloneServer);
    return;
  }

  // Fallback: next start (createServer already patched)
  const port = process.env.PORT || "20128";
  const hostname = process.env.HOSTNAME || process.env.HOST || "0.0.0.0";
  const nextBin = require.resolve("next/dist/bin/next");
  process.argv = [
    process.argv[0],
    nextBin,
    "start",
    "--port",
    String(port),
    "--hostname",
    String(hostname),
  ];
  require(nextBin);
}

boot();
