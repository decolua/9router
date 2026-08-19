"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const next = require("next");
const { attachCodexNativeGateway } = require("./server/codexNativeGateway.cjs");

const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const port = Number.parseInt(process.env.PORT || "20127", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
process.env.CODEX_NATIVE_INTERNAL_SECRET ||= crypto.randomBytes(32).toString("hex");
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

function stampPeer(request) {
  const socketIp = request.socket?.remoteAddress || "";
  const forwarded = request.headers["x-forwarded-for"];
  const realIp = request.headers["x-real-ip"];
  const viaProxy = !!(forwarded || realIp);
  const loopback = socketIp === "127.0.0.1"
    || socketIp === "::1"
    || socketIp === "::ffff:127.0.0.1";
  const proxyIp = realIp || (forwarded ? String(forwarded).split(",")[0].trim() : "");
  delete request.headers["x-forwarded-for"];
  delete request.headers["x-9r-real-ip"];
  delete request.headers["x-9r-via-proxy"];
  delete request.headers["x-9r-peer-token"];
  request.headers["x-9r-real-ip"] = loopback && proxyIp ? proxyIp : socketIp;
  request.headers["x-9r-peer-token"] = PEER_TOKEN;
  if (viaProxy) request.headers["x-9r-via-proxy"] = "1";
}

async function start() {
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const handleNextUpgrade = app.getUpgradeHandler();
  const server = http.createServer((request, response) => {
    stampPeer(request);
    handle(request, response);
  });
  const gateway = attachCodexNativeGateway(server, {
    secret: process.env.CODEX_NATIVE_INTERNAL_SECRET,
    internalBaseUrl: `http://127.0.0.1:${port}`,
  });
  server.on("upgrade", (request, socket, head) => {
    stampPeer(request);
    if (!gateway.handles(request)) handleNextUpgrade(request, socket, head);
  });
  server.listen(port, hostname, () => {
    console.log(`> 9Router ready on http://${hostname}:${port} (${dev ? "development" : "production"})`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
