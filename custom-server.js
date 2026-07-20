const http = require("http");
const fs = require("node:fs");
const {
  REQUEST_PROOF_ENV,
  REQUEST_PROOF_HEADER,
  createRequestProof,
  resolveTrustedClientIp,
} = require("./client-ip.js");

const origCreate = http.createServer.bind(http);
const requestProof = createRequestProof();
process.env[REQUEST_PROOF_ENV] = requestProof;
if (!process.env.PORT) process.env.PORT = "20127";

// Wrap Next HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const client = resolveTrustedClientIp({
      socketIp,
      headers: req.headers,
      trustProxy: process.env.TRUST_PROXY === "true",
    });

    delete req.headers[REQUEST_PROOF_HEADER];
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-9r-ip-source"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-real-ip"];
    delete req.headers["cf-connecting-ip"];
    delete req.headers.forwarded;
    delete req.headers["x-9r-via-proxy"];
    req.headers[REQUEST_PROOF_HEADER] = requestProof;
    req.headers["x-9r-real-ip"] = client.ip;
    req.headers["x-9r-ip-source"] = client.source;
    if (client.viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  return origCreate(...rest, wrapped);
};

if (fs.existsSync("./server.js")) {
  require("./server.js");
} else {
  process.argv.push("start", "--port", process.env.PORT);
  require("next/dist/bin/next");
}
