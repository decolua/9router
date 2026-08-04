const http = require("http");
const crypto = require("crypto");
const { attachCodexNativeGateway } = require("./server/codexNativeGateway.cjs");

// Renaming next-server process to a unique name while keeping "next-server"
// in the name for backward compatibility with existing process-matching whitelists.
process.title = "9router next-server";
Object.defineProperty(process, "title", {
  get: () => "9router next-server",
  set: () => {},
  configurable: true
});

const origCreate = http.createServer.bind(http);
process.env.CODEX_NATIVE_INTERNAL_SECRET ||= crypto.randomBytes(32).toString("hex");

function skipClaimedUpgrade(server, gateway) {
  const originalOn = server.on.bind(server);
  const originalOnce = server.once.bind(server);
  const wrap = (listener) => (request, socket, head) => {
    if (!gateway.handles(request)) return listener(request, socket, head);
  };
  server.on = function on(event, listener) {
    return originalOn(event, event === "upgrade" ? wrap(listener) : listener);
  };
  server.addListener = server.on;
  server.once = function once(event, listener) {
    return originalOnce(event, event === "upgrade" ? wrap(listener) : listener);
  };
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
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  const gateway = attachCodexNativeGateway(server, {
    secret: process.env.CODEX_NATIVE_INTERNAL_SECRET,
  });
  skipClaimedUpgrade(server, gateway);
  return server;
};

require("./server.js");
