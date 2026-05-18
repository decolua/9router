/**
 * gRPC over HTTP/2 client for the local Windsurf LS subprocess.
 *
 * Adapted from dwgx/WindsurfAPI's grpc.js. Stripped down: we only ship
 * legacy gRPC framing (Connect-protocol mode in dwgx is opt-in and has
 * known parser bugs), and we don't need a multi-port session pool —
 * 9router runs one LS so we keep one HTTP/2 session.
 *
 * Public API:
 *   grpcFrame(payload) → Buffer  — wrap protobuf in gRPC length-prefix
 *   grpcUnary(port, csrf, path, body, timeout) → Promise<Buffer>
 *   grpcStream(port, csrf, path, body, { onData, onEnd, onError, timeout })
 *   closeSessionForPort(port)
 */
import http2 from "node:http2";
import { log } from "./config.js";

const _sessionPool = new Map();

function getSession(port) {
  const key = `localhost:${port}`;
  let session = _sessionPool.get(key);
  if (session && !session.destroyed && !session.closed) return session;

  session = http2.connect(`http://localhost:${port}`);
  session.on("error", (err) => {
    log.debug?.(`HTTP/2 session error on port ${port}: ${err.message}`);
    if (_sessionPool.get(key) === session) _sessionPool.delete(key);
  });
  session.on("close", () => {
    if (_sessionPool.get(key) === session) _sessionPool.delete(key);
  });
  try { session.unref(); } catch {}
  _sessionPool.set(key, session);
  return session;
}

export function closeSessionForPort(port) {
  const key = `localhost:${port}`;
  const session = _sessionPool.get(key);
  if (session) {
    try { session.close(); } catch {}
    _sessionPool.delete(key);
  }
}

export function grpcFrame(payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const frame = Buffer.alloc(5 + buf.length);
  frame[0] = 0;                           // not compressed
  frame.writeUInt32BE(buf.length, 1);     // big-endian length
  buf.copy(frame, 5);
  return frame;
}

export function stripGrpcFrame(buf) {
  if (buf.length >= 5 && buf[0] === 0) {
    const msgLen = buf.readUInt32BE(1);
    if (buf.length >= 5 + msgLen) return buf.subarray(5, 5 + msgLen);
  }
  return buf;
}

export function extractGrpcFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const compressed = buf[offset];
    const msgLen = buf.readUInt32BE(offset + 1);
    if (compressed !== 0 || offset + 5 + msgLen > buf.length) break;
    frames.push(buf.subarray(offset + 5, offset + 5 + msgLen));
    offset += 5 + msgLen;
  }
  return frames;
}

const HEADERS_BASE = {
  ":method": "POST",
  "content-type": "application/grpc",
  "te": "trailers",
  "user-agent": "grpc-node/1.108.2",
};

export function grpcUnary(port, csrfToken, rpcPath, body, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, ...args) => { if (!settled) { settled = true; fn(...args); } };

    const client = getSession(port);
    const chunks = [];
    let timer;
    let req;

    timer = setTimeout(() => {
      try { req?.close?.(http2.constants.NGHTTP2_CANCEL); } catch {}
      done(reject, new Error("gRPC unary timeout"));
    }, timeout);

    req = client.request({
      ...HEADERS_BASE,
      ":path": rpcPath,
      "x-codeium-csrf-token": csrfToken,
    });
    req.on("data", (c) => chunks.push(c));

    let grpcStatus = "0", grpcMessage = "";
    req.on("trailers", (t) => {
      grpcStatus = String(t["grpc-status"] ?? "0");
      grpcMessage = String(t["grpc-message"] ?? "");
    });

    req.on("end", () => {
      clearTimeout(timer);
      if (grpcStatus !== "0") {
        const msg = grpcMessage ? decodeURIComponent(grpcMessage) : `gRPC status ${grpcStatus}`;
        done(reject, new Error(msg));
        return;
      }
      const full = Buffer.concat(chunks);
      const frames = extractGrpcFrames(full);
      done(resolve, frames.length > 0 ? Buffer.concat(frames) : stripGrpcFrame(full));
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      done(reject, err);
    });

    req.write(body);
    req.end();
  });
}

export function grpcStream(port, csrfToken, rpcPath, body, opts = {}) {
  const { onData, onEnd, onError, timeout = 300_000 } = opts;
  let settled = false;
  const client = getSession(port);
  let pendingBuf = Buffer.alloc(0);
  let req;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { req?.close?.(http2.constants.NGHTTP2_CANCEL); } catch {}
    onError?.(new Error("gRPC stream timeout"));
  }, timeout);

  req = client.request({
    ...HEADERS_BASE,
    ":path": rpcPath,
    "x-codeium-csrf-token": csrfToken,
    "grpc-accept-encoding": "identity,gzip,deflate",
  });

  req.on("data", (chunk) => {
    if (settled) return;
    pendingBuf = Buffer.concat([pendingBuf, chunk]);
    if (pendingBuf.length > 100 * 1024 * 1024) {
      settled = true;
      clearTimeout(timer);
      try { req.close?.(http2.constants.NGHTTP2_CANCEL); } catch {}
      onError?.(new Error("gRPC frame too large (>100MB)"));
      return;
    }
    while (pendingBuf.length >= 5) {
      const compressed = pendingBuf[0];
      const msgLen = pendingBuf.readUInt32BE(1);
      if (pendingBuf.length < 5 + msgLen) break;
      if (compressed === 0) {
        onData?.(pendingBuf.subarray(5, 5 + msgLen));
      }
      pendingBuf = pendingBuf.subarray(5 + msgLen);
    }
  });

  let grpcStatus = "0", grpcMessage = "";
  req.on("trailers", (t) => {
    grpcStatus = String(t["grpc-status"] ?? "0");
    grpcMessage = String(t["grpc-message"] ?? "");
  });

  req.on("end", () => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    if (grpcStatus !== "0") {
      const msg = grpcMessage ? decodeURIComponent(grpcMessage) : `gRPC status ${grpcStatus}`;
      onError?.(new Error(msg));
    } else {
      onEnd?.();
    }
  });

  req.on("error", (err) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    onError?.(err);
  });

  req.write(body);
  req.end();
}
