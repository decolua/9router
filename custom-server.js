const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { pathToFileURL } = require("url");

const origCreate = http.createServer.bind(http);

// ─── Codex WebSocket transport ────────────────────────────────────────────────
//
// Codex ≥0.147 with `supports_websockets = true` upgrades
// `<base_url>/responses` instead of POSTing it. The client sends one text frame:
//
//   {"type":"response.create","model":"…","input":[…]}
//
// which is the ordinary Responses body plus a `type` discriminator. Replies are
// the same event objects SSE carries (`response.output_text.delta`,
// `response.completed`, …), one JSON object per text frame.
//
// The frame codec is hand-rolled rather than pulling in `ws`: this file is
// copied into the standalone output on its own (see Dockerfile), so a require()
// that Next's dependency tracing never saw would crash the server at boot. We
// decline `permessage-deflate` in the handshake, which keeps the codec to plain
// frames. Requests are bridged back through this process's own HTTP port so the
// whole routing/auth pipeline is reused exactly as the POST path uses it.

const CODEX_WS_PATH = "/backend-api/codex/responses";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_WS_MESSAGE_BYTES = 64 * 1024 * 1024;

function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

// Server→client frames are never masked and we only ever send text or close.
function encodeWsFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, body]);
}

// Incremental decoder: returns complete messages, buffering partial frames and
// reassembling continuation fragments.
function createWsDecoder(onMessage, onClose, onPing) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = null;

  return function push(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        const big = buffer.readBigUInt64BE(offset);
        if (big > BigInt(MAX_WS_MESSAGE_BYTES)) return onClose(1009, "message too large");
        length = Number(big);
        offset += 8;
      }
      if (length > MAX_WS_MESSAGE_BYTES) return onClose(1009, "message too large");

      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;

      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(offset + length);

      if (opcode === 0x8) return onClose(payload.length >= 2 ? payload.readUInt16BE(0) : 1005, "");
      if (opcode === 0x9) { onPing(payload); continue; }
      if (opcode === 0xa) continue; // pong

      if (opcode === 0x0) {
        fragments.push(payload);
      } else {
        fragments = [payload];
        fragmentOpcode = opcode;
      }
      // The per-frame limit above does not bound a stream of small continuation
      // frames that never sets FIN, so cap the reassembled total too.
      let buffered = 0;
      for (const part of fragments) buffered += part.length;
      if (buffered > MAX_WS_MESSAGE_BYTES) {
        fragments = [];
        fragmentOpcode = null;
        return onClose(1009, "message too large");
      }
      if (!fin) continue;

      const message = Buffer.concat(fragments);
      fragments = [];
      const wasText = fragmentOpcode === 0x1;
      fragmentOpcode = null;
      if (wasText) onMessage(message.toString("utf8"));
    }
  };
}

// Run one `response.create` through this process's own HTTP endpoint and relay
// each SSE event back as a text frame.
function bridgeCodexTurn(request, port, headers, peerIp, send, done) {
  const { type, ...body } = request;
  void type;
  body.stream = true; // the WS transport is inherently streaming

  const payload = Buffer.from(JSON.stringify(body), "utf8");
  const forwarded = { "content-type": "application/json", "content-length": payload.length };
  // Carry through auth and Codex's own request metadata, but drop:
  //   - hop-by-hop / websocket-specific headers, meaningless on a POST;
  //   - forwarding headers — the bridged request originates from 127.0.0.1, so
  //     the wrapper above treats it as a local reverse proxy and would trust a
  //     remote client's own x-forwarded-for, letting it pick the IP used for
  //     rate limiting. The real peer is attached below instead;
  //   - cookie, so a browser-initiated handshake cannot ride a session cookie
  //     into a route that accepts one.
  for (const [name, value] of Object.entries(headers)) {
    if (/^(host|connection|upgrade|sec-websocket-|content-length|content-type)/i.test(name)) continue;
    if (/^(x-forwarded-for|x-real-ip|x-9r-|cookie)/i.test(name)) continue;
    forwarded[name] = value;
  }
  if (peerIp) forwarded["x-forwarded-for"] = peerIp;

  const req = http.request(
    { host: "127.0.0.1", port, path: CODEX_WS_PATH, method: "POST", headers: forwarded },
    (res) => {
      let pending = "";
      res.setEncoding("utf8");

      // A rejected turn (401, unknown model, upstream failure) answers with a
      // JSON error body, not an event stream. Without this the SSE parser finds
      // no `data:` lines and the client is left waiting on a silent socket.
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let error;
          try {
            error = JSON.parse(raw).error;
          } catch {
            error = null;
          }
          send(JSON.stringify({
            type: "error",
            error: error || { message: `Request failed with status ${res.statusCode}`, type: "server_error" },
          }));
          done(null, res.statusCode);
        });
        res.on("error", (error) => done(error));
        return;
      }

      res.on("data", (chunk) => {
        pending += chunk;
        let index;
        while ((index = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          send(data);
        }
      });
      res.on("end", () => done(null));
      res.on("error", (error) => done(error));
    }
  );
  req.on("error", (error) => done(error));
  req.end(payload);
}

function handleCodexUpgrade(req, socket, head, port) {
  const key = req.headers["sec-websocket-key"];
  if (!key || String(req.headers["sec-websocket-version"] || "") !== "13") {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return socket.destroy();
  }

  // Codex sends no Origin. A browser always does, so a present Origin that is
  // not this host means a web page is driving the socket — refuse it rather
  // than let any site reach a local gateway.
  const origin = req.headers.origin;
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== req.headers.host) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
  }

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const peerIp = socket.remoteAddress || "";
  // Codex tags the connection's purpose here; a malformed value just means we
  // treat the connection as a normal turn.
  let isPrewarm = false;
  try {
    isPrewarm = JSON.parse(req.headers["x-codex-turn-metadata"] || "{}").request_kind === "prewarm";
  } catch {
    isPrewarm = false;
  }
  let closed = false;
  const send = (text) => {
    if (!closed && socket.writable) socket.write(encodeWsFrame(0x1, text));
  };
  const close = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    if (socket.writable) socket.write(encodeWsFrame(0x8, payload));
    socket.end();
  };

  const decode = createWsDecoder(
    (text) => {
      let request;
      try {
        request = JSON.parse(text);
      } catch {
        send(JSON.stringify({ type: "error", error: { message: "Invalid JSON frame", type: "invalid_request_error" } }));
        return close(1007, "invalid json");
      }
      if (request?.type !== "response.create") {
        // Anything else is a control message this bridge does not implement;
        // ignoring beats closing a connection the client still wants.
        return;
      }

      // Codex opens a second connection at session start carrying
      // `request_kind: "prewarm"` and sends the full turn payload down it, so
      // the upstream prompt cache is already warm when the user hits enter.
      // Answering it locally with a synthetic `response.completed` is what the
      // client then adopts as the turn's answer — the user sees a blank reply
      // and nothing is ever routed. Treat it as an ordinary turn instead: the
      // payload is one, ChatGPT caches it, and the next turn reuses that cache.
      if (isPrewarm) console.log(`[CodexWS] prewarm turn from ${peerIp} routed upstream`);
      bridgeCodexTurn(request, port, req.headers, peerIp, send, (error, rejectedStatus) => {
        if (error) {
          send(JSON.stringify({ type: "error", error: { message: error.message, type: "server_error" } }));
          return close(1011, "bridge error");
        }
        // A rejected turn already sent its error frame; close so the client
        // stops waiting instead of holding a socket that will never stream.
        if (rejectedStatus) return close(1011, `upstream ${rejectedStatus}`);
        // Otherwise leave the socket open: Codex opens one connection per turn
        // and closes it itself, and closing early races its own shutdown.
      });
    },
    (code) => close(code === 1005 ? 1000 : code, ""),
    (payload) => {
      if (!closed && socket.writable) socket.write(encodeWsFrame(0xa, payload));
    }
  );

  const feed = (chunk) => {
    try {
      decode(chunk);
    } catch (error) {
      console.error("[CodexWS] frame decode failed:", error && error.message ? error.message : error);
      close(1011, "decode error");
    }
  };
  // Node hands over any bytes that arrived in the same segment as the
  // handshake. Codex sends `response.create` immediately, so that first frame
  // is often already here — dropping `head` would hang the turn forever.
  if (head && head.length) feed(head);
  socket.on("data", feed);
  socket.on("error", () => { closed = true; });
  socket.on("close", () => { closed = true; });
}

let backgroundRefreshStarted = false;

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
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
  });
  const origEmit = server.emit;
  // JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close.
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event === "upgrade" && String(req.headers.upgrade || "").toLowerCase() === "websocket") {
      const requestPath = String(req.url || "").split("?")[0].replace(/\/+$/, "");
      // Codex appends /v1 to the base URL in some configurations; both spellings
      // reach the same route on the HTTP side, so accept both here too.
      if (requestPath === CODEX_WS_PATH || requestPath === "/backend-api/codex/v1/responses") {
        const port = this.address() && this.address().port;
        if (port) {
          handleCodexUpgrade(req, socket, head, port);
          return true;
        }
      }
    }
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
