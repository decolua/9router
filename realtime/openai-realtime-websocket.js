const http = require("http");
const { WebSocket, WebSocketServer } = require("ws");

const MAX_SESSIONS = 8;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const SETUP_TIMEOUT_MS = 15000;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const REVALIDATE_MS = 30000;
const pendingByIp = new Map();
const REALTIME_MODELS = new Set(require("./realtime-models.cjs"));

let activeSessions = 0;
let pendingSessions = 0;

function reject(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function modelFromRequest(req) {
  try {
    const models = new URL(req.url, "http://localhost").searchParams.getAll("model");
    if (models.length !== 1) return "";
    return models[0].startsWith("openai/") ? models[0].slice(7) : models[0];
  }
  catch { return ""; }
}

function defaultResolve(server, req, model, validateOnly = false, retry = null) {
  const address = server.address();
  if (!address || typeof address === "string") return Promise.resolve({ status: 503 });
  const secret = globalThis[Symbol.for("9router.realtime.internal-secret")];
  if (typeof secret !== "string") return Promise.resolve({ status: 503 });
  const body = JSON.stringify(validateOnly ? { model, validateOnly: true, ...retry } : { model, ...retry });
  const headers = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "x-9r-realtime-secret": secret,
  };
  const authorization = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];
  if (typeof authorization === "string") headers.authorization = authorization;
  if (typeof apiKey === "string") headers["x-api-key"] = apiKey;
  const host = address.family === "IPv6" ? "::1" : "127.0.0.1";
  return new Promise((resolve) => {
    const request = http.request({ host, port: address.port, path: "/api/internal/realtime-credentials", method: "POST", headers, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (validateOnly && response.statusCode === 204) return resolve({ valid: true });
        if (response.statusCode !== 200) return resolve({ status: response.statusCode || 503 });
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (typeof result.apiKey !== "string" || !result.apiKey) return resolve({ status: 503 });
          resolve({ apiKey: result.apiKey, connectionId: result.connectionId });
        } catch { resolve({ status: 503 }); }
      });
    });
    request.setTimeout(SETUP_TIMEOUT_MS, () => request.destroy());
    request.on("error", () => resolve({ status: 503 }));
    request.end(body);
  });
}

function validUpgrade(req, model) {
  return req.method === "GET" && !req.headers.origin &&
    /^websocket$/i.test(req.headers.upgrade || "") && /\bupgrade\b/i.test(req.headers.connection || "") &&
    req.headers["sec-websocket-version"] === "13" &&
    /^[+/0-9A-Za-z]{22}==$/.test(req.headers["sec-websocket-key"] || "") && !!model;
}

// Direct-only relay for the official OpenAI Realtime protocol. It deliberately
// does not inspect or rewrite frames, so protocol additions pass through intact.
module.exports = function openAIRealtimeWebSocket(server, req, socket, head, options = {}) {
  const model = modelFromRequest(req);
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch { return false; }
  if (pathname !== "/v1/realtime" || model === "cx/gpt-live-1-codex") return false;
  if (!validUpgrade(req, model)) {
    reject(socket, "400 Bad Request");
    return true;
  }
  const pollinations = model.startsWith("pollinations/");
  if (!REALTIME_MODELS.has(model) && !(pollinations && /^pollinations\/[a-z0-9][a-z0-9._/-]{0,199}$/i.test(model))) { reject(socket, "400 Bad Request"); return true; }
  if (!req.headers.authorization && !req.headers["x-api-key"]) { reject(socket, "401 Unauthorized"); return true; }
  const ip = socket.remoteAddress || "unknown";
  if ((pendingByIp.get(ip) || 0) >= 2 || activeSessions + pendingSessions >= MAX_SESSIONS) { reject(socket, "503 Service Unavailable"); return true; }
  pendingByIp.set(ip, (pendingByIp.get(ip) || 0) + 1);
  pendingSessions++;
  let pending = true;
  let counted = false;
  const releasePending = () => {
    if (!pending) return;
    pending = false;
    pendingSessions--;
    const remaining = pendingByIp.get(ip) - 1;
    if (remaining) pendingByIp.set(ip, remaining); else pendingByIp.delete(ip);
  };
  let closed = false;
  let client;
  let upstream;
  let timeout;
  let revalidateTimer;
  const close = (code = 1011, reason = "") => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    clearTimeout(revalidateTimer);
    releasePending();
    if (!Number.isInteger(code) || code === 1005 || code === 1006 || code === 1015) { code = 1011; reason = ""; }
    for (const ws of [client, upstream]) {
      try { if (ws && ws.readyState < 2) ws.close(code, reason); } catch { try { ws.terminate(); } catch {} }
    }
    if (counted) {
      // ponytail: allow one second for graceful closes; use close-event accounting for higher throughput.
      setTimeout(() => {
        for (const ws of [client, upstream]) {
          try { if (ws && ws.readyState !== WebSocket.CLOSED) ws.terminate(); } catch {}
        }
        activeSessions--;
      }, 1000).unref();
    }
    if (!client && socket.writable) socket.destroy();
  };
  const fail = (status = "502 Bad Gateway") => {
    if (!client) reject(socket, status);
    close();
  };
  const onSocketClose = () => close();
  socket.once("close", onSocketClose);
  socket.on("error", () => close());
  timeout = setTimeout(() => fail(), SETUP_TIMEOUT_MS);
  const resolve = options.resolve || ((request, requestedModel, validateOnly, retry) => defaultResolve(server, request, requestedModel, validateOnly, retry));
  const excluded = [];
  const connect = (retry = null) => Promise.resolve().then(() => resolve(req, model, false, retry)).then((result) => {
    if (closed) return;
    if (result?.status) return fail(`${result.status} ${result.status === 401 ? "Unauthorized" : result.status === 403 ? "Forbidden" : result.status === 400 ? "Bad Request" : "Service Unavailable"}`);
    if (!result?.apiKey) return fail();
    if (excluded.includes(result.connectionId)) return fail();
    const url = pollinations
      ? `wss://gen.pollinations.ai/v1/realtime?model=${encodeURIComponent(model.slice(13))}`
      : `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    const createUpstream = options.createUpstream || ((target, key) => new WebSocket(target, {
      headers: { authorization: `Bearer ${key}`, "openai-beta": "realtime=v1" },
      perMessageDeflate: false,
      maxPayload: MAX_PAYLOAD_BYTES,
    }));
    upstream = createUpstream(url, result.apiKey);
    let handshakeFailed = false;
    upstream.once("error", () => { if (!handshakeFailed) fail(); });
    upstream.once("unexpected-response", (_request, response) => {
      handshakeFailed = true;
      response.destroy();
      upstream.terminate();
      if (!result.connectionId || closed) return fail();
      excluded.push(result.connectionId);
      connect({ excluded, failure: { connectionId: result.connectionId, status: response.statusCode } });
    });
    upstream.once("open", () => {
      if (closed) return;
      releasePending();
      if (activeSessions >= MAX_SESSIONS) return fail("503 Service Unavailable");
      activeSessions++;
      counted = true;
      clearTimeout(timeout);
      const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: false });
      try {
        wss.handleUpgrade(req, socket, head, (accepted) => {
          client = accepted;
          socket.removeListener("close", onSocketClose);
          timeout = setTimeout(() => close(), SESSION_TIMEOUT_MS);
          const revalidate = async () => {
            revalidateTimer = setTimeout(() => close(1008, "Authorization unavailable"), SETUP_TIMEOUT_MS);
            try {
              const result = await resolve(req, model, true, { connectionId: resultConnection.connectionId, apiKey: resultConnection.apiKey });
              if (closed) return;
              clearTimeout(revalidateTimer);
              if (result?.valid !== true) return close(1008, "Authorization revoked");
              revalidateTimer = setTimeout(revalidate, options.revalidateMs || REVALIDATE_MS);
            } catch { close(1008, "Authorization unavailable"); }
          };
          const resultConnection = result;
          revalidateTimer = setTimeout(revalidate, options.revalidateMs || REVALIDATE_MS);
          const relay = (from, to, binary) => {
            if (closed) return;
            if (to.readyState !== WebSocket.OPEN || to.bufferedAmount > MAX_BUFFERED_BYTES) return close();
            try { to.send(from, { binary }); } catch { close(); }
          };
          client.on("message", (data, binary) => relay(data, upstream, binary));
          upstream.on("message", (data, binary) => relay(data, client, binary));
          client.on("close", (code, reason) => close(code, reason));
          upstream.on("close", (code, reason) => close(code, reason));
          client.on("error", () => close());
        });
      } catch { fail(); }
    });
  }).catch(() => fail());
  connect();
  return true;
};

module.exports._constants = { MAX_SESSIONS, MAX_BUFFERED_BYTES, MAX_PAYLOAD_BYTES, SESSION_TIMEOUT_MS };