"use strict";

const { WebSocket, WebSocketServer } = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

const NATIVE_PATH = "/v1/codex/responses";
const UPSTREAM_URL = "wss://chatgpt.com/backend-api/codex/responses";
const HIGH_WATER_MARK = 1024 * 1024;
const RESPONSE_HEADERS = new Set([
  "cache-control",
  "openai-model",
  "retry-after",
  "x-codex-turn-state",
  "x-models-etag",
  "x-reasoning-included",
  "x-request-id",
]);
const RESPONSE_PREFIXES = ["openai-", "x-codex-", "x-openai-", "x-ratelimit-", "x-request-", "x-stainless-"];

function isNativeUpgrade(request) {
  try {
    return new URL(request.url, "http://127.0.0.1").pathname === NATIVE_PATH;
  } catch {
    return false;
  }
}

function wsDisabled() {
  return /^(1|true|yes|on)$/i.test(process.env.CODEX_NATIVE_WS_DISABLED || "");
}

function clientVersion(request) {
  const explicit = request.headers["x-codex-client-version"];
  if (explicit) return String(explicit);
  const match = String(request.headers["user-agent"] || "").match(/\bcodex(?:_cli_rs)?\/([^\s]+)/i);
  return match ? match[1] : null;
}

function requestHeaderObject(request) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (value != null && name.toLowerCase() !== "x-9r-internal-secret") {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  return headers;
}

function noProxyMatches(target, noProxy) {
  if (!noProxy) return false;
  const hostname = new URL(target).hostname.toLowerCase();
  return String(noProxy).split(",").map((entry) => entry.trim().toLowerCase()).some((entry) => {
    if (!entry) return false;
    if (entry === "*") return true;
    if (entry.startsWith(".")) return hostname === entry.slice(1) || hostname.endsWith(entry);
    return hostname === entry || hostname.endsWith(`.${entry}`);
  });
}

function proxyAgent(proxy) {
  if (!proxy?.enabled || !proxy.url || noProxyMatches(UPSTREAM_URL, proxy.noProxy)) return undefined;
  const rawUrl = proxy.url.includes("://") ? proxy.url : `http://${proxy.url}`;
  const protocol = new URL(rawUrl).protocol;
  if (protocol === "http:" || protocol === "https:") return new HttpsProxyAgent(rawUrl);
  if (protocol.startsWith("socks")) return new SocksProxyAgent(rawUrl);
  throw new Error(`Unsupported WebSocket proxy scheme ${protocol}`);
}

function semanticEvent(event) {
  const type = event?.type;
  return typeof type === "string" && (
    type.startsWith("response.output_")
    || type.includes("output_text")
    || type.includes("reasoning")
    || type.includes("function_call")
    || type.includes("tool_call")
    || type.includes("image_generation")
    || type === "response.completed"
  );
}

function safeHandshakeHeaders(upstreamHeaders) {
  const result = {};
  for (const [name, value] of Object.entries(upstreamHeaders || {})) {
    const lower = name.toLowerCase();
    if (RESPONSE_HEADERS.has(lower) || RESPONSE_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      result[lower] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  return result;
}

function sendWithBackpressure(destination, data, options, source) {
  if (!destination || destination.readyState !== WebSocket.OPEN) return;
  if (destination.bufferedAmount > HIGH_WATER_MARK) source?._socket?.pause?.();
  destination.send(data, options, (error) => {
    if (destination.bufferedAmount <= HIGH_WATER_MARK / 2) source?._socket?.resume?.();
    if (error && source?.readyState === WebSocket.OPEN) source.close(1011, "WebSocket relay failed");
  });
}

function rejectUpgrade(socket, status, message) {
  const body = JSON.stringify({ error: { code: "codex_websocket_unavailable", message } });
  const label = status === 401 ? "Unauthorized" : status === 503 ? "Service Unavailable" : "Bad Gateway";
  socket.end(
    `HTTP/1.1 ${status} ${label}\r\n`
    + "Content-Type: application/json\r\n"
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + "Connection: close\r\n\r\n"
    + body
  );
}

function relayCloseCode(code, fallback = 1000) {
  const standard = code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code);
  return standard || (code >= 3000 && code <= 4999) ? code : fallback;
}

function attachCodexNativeGateway(server, options = {}) {
  const secret = options.secret || process.env.CODEX_NATIVE_INTERNAL_SECRET;
  if (!secret) throw new Error("CODEX_NATIVE_INTERNAL_SECRET is required");
  const internalBaseUrl = options.internalBaseUrl
    || `http://127.0.0.1:${process.env.PORT || 20127}`;
  const fetchImpl = options.fetch || globalThis.fetch;
  const upstreamUrl = options.upstreamUrl || UPSTREAM_URL;
  const WebSocketImpl = options.WebSocket || WebSocket;
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: true,
    autoPong: false,
    handleProtocols(protocols) {
      return protocols.values().next().value || false;
    },
  });

  wss.on("headers", (headers, request) => {
    for (const [name, value] of Object.entries(request.__codexUpstreamHeaders || {})) {
      headers.push(`${name}: ${value}`);
    }
  });

  async function leaseAction(action, payload) {
    const response = await fetchImpl(`${internalBaseUrl}/api/internal/codex-native/lease/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-9r-internal-secret": secret,
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Lease ${action} failed (${response.status})`);
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  }

  function connectUpstream(lease, request) {
    return new Promise((resolve, reject) => {
      let agent;
      try {
        agent = proxyAgent(lease.proxy);
      } catch (error) {
        reject(error);
        return;
      }
      const protocols = String(request.headers["sec-websocket-protocol"] || "")
        .split(",").map((value) => value.trim()).filter(Boolean);
      const upstream = new WebSocketImpl(
        upstreamUrl,
        protocols.length ? protocols : undefined,
        {
          headers: lease.upstreamHeaders,
          agent,
          perMessageDeflate: true,
          autoPong: false,
          handshakeTimeout: 10_000,
        }
      );
      let upgradeHeaders = {};
      upstream.once("upgrade", (response) => {
        upgradeHeaders = safeHandshakeHeaders(response.headers);
      });
      upstream.once("open", () => resolve({ upstream, upgradeHeaders }));
      upstream.once("unexpected-response", (_request, response) => {
        const error = new Error(`Codex WebSocket handshake rejected (${response.statusCode})`);
        error.status = response.statusCode || 502;
        response.resume();
        reject(error);
      });
      upstream.once("error", reject);
    });
  }

  async function acquireConnected(request, excludeConnectionIds = [], model = null) {
    const lease = await leaseAction("acquire", {
      requestHeaders: requestHeaderObject(request),
      clientVersion: clientVersion(request),
      excludeConnectionIds,
      model,
    });
    try {
      const connected = await connectUpstream(lease, request);
      return { lease, ...connected };
    } catch (error) {
      await leaseAction("failure", {
        leaseId: lease.leaseId,
        status: error.status || 502,
        error: error.message,
      }).catch(() => {});
      await leaseAction("release", { leaseId: lease.leaseId }).catch(() => {});
      throw Object.assign(error, { connectionId: lease.connectionId });
    }
  }

  async function handleUpgrade(request, socket, head) {
    if (!isNativeUpgrade(request)) return;
    if (wsDisabled()) {
      rejectUpgrade(socket, 503, "Codex Native WebSocket is disabled; use HTTP/SSE fallback");
      return;
    }

    const excluded = [];
    let connected;
    for (;;) {
      try {
        connected = await acquireConnected(request, excluded);
        break;
      } catch (error) {
        if (error.connectionId) excluded.push(error.connectionId);
        if (error.status === 401 || !error.connectionId) {
          rejectUpgrade(socket, error.status === 401 ? 401 : 503, error.message);
          return;
        }
        // Continue until the pool explicitly reports no eligible account.
      }
    }

    request.__codexUpstreamHeaders = connected.upgradeHeaders;
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request, connected);
    });
  }

  wss.on("connection", (client, request, initial) => {
    let lease = initial.lease;
    let upstream = initial.upstream;
    let model = null;
    let validating = false;
    let validated = false;
    let semanticOutputSeen = false;
    let closed = false;
    let failoverInProgress = false;
    const queued = [];
    const turnFrames = [];
    const excluded = [lease.connectionId];

    const cleanupLease = () => leaseAction("release", { leaseId: lease.leaseId }).catch(() => {});
    const closeBoth = (code = 1000, reason = "") => {
      if (closed) return;
      closed = true;
      const safeCode = relayCloseCode(code, code === 1003 || code === 1008 || code === 1011 ? code : 1000);
      if (client.readyState === WebSocket.OPEN) client.close(safeCode, reason);
      if (upstream.readyState === WebSocket.OPEN) upstream.close(safeCode, reason);
      cleanupLease();
    };

    const parse = (data) => {
      try { return JSON.parse(data.toString()); } catch { return null; }
    };

    async function validateAndFlush(frame) {
      const event = parse(frame.data);
      if (!event || event.type !== "response.create" || typeof event.model !== "string") {
        closeBoth(1008, "First Codex frame must be response.create with a model");
        return;
      }
      model = event.model;
      validating = true;
      try {
        try {
          await leaseAction("validate-model", { leaseId: lease.leaseId, model });
        } catch (error) {
          if (error.status !== 409) {
            closeBoth(1008, `Model '${model}' is not available on the leased metadata cohort`);
            return;
          }

          // The model is only known on response.create. If the handshake lease
          // belongs to another metadata cohort, replace it before sending bytes.
          failoverInProgress = true;
          const previousLeaseId = lease.leaseId;
          const previousUpstream = upstream;
          await leaseAction("release", { leaseId: previousLeaseId }).catch(() => {});
          previousUpstream.removeAllListeners();
          previousUpstream.terminate();
          try {
            const next = await acquireConnected(request, excluded, model);
            excluded.push(next.lease.connectionId);
            lease = next.lease;
            upstream = next.upstream;
            await leaseAction("validate-model", { leaseId: lease.leaseId, model });
            bindUpstreamEvents();
          } catch {
            closeBoth(1008, `Model '${model}' is not available on a WebSocket-capable metadata cohort`);
            return;
          } finally {
            failoverInProgress = false;
          }
        }

        validated = true;
        turnFrames.push(frame);
        sendWithBackpressure(upstream, frame.data, { binary: false, compress: frame.compress }, client);
        for (const pending of queued.splice(0)) {
          turnFrames.push(pending);
          sendWithBackpressure(upstream, pending.data, { binary: false, compress: pending.compress }, client);
        }
      } finally {
        validating = false;
      }
    }

    function bindUpstreamEvents() {
      const boundUpstream = upstream;
      boundUpstream.on("ping", (data) => {
        if (client.readyState === WebSocket.OPEN) client.ping(data);
      });
      boundUpstream.on("pong", (data) => {
        if (client.readyState === WebSocket.OPEN) client.pong(data);
      });
      boundUpstream.on("message", (data, isBinary) => {
        if (isBinary) {
          closeBoth(1003, "Binary Codex frames are not supported");
          return;
        }
        const event = parse(data);
        if (event?.type === "codex.rate_limits") {
          leaseAction("quota-event", { leaseId: lease.leaseId, event }).catch(() => {});
        }
        if (semanticEvent(event)) {
          semanticOutputSeen = true;
          turnFrames.length = 0;
          leaseAction("semantic-output", { leaseId: lease.leaseId }).catch(() => {});
        }
        if (event?.type === "response.completed") {
          leaseAction("success", { leaseId: lease.leaseId }).catch(() => {});
        }
        sendWithBackpressure(client, data, { binary: false, compress: true }, upstream);
      });
      boundUpstream.on("close", async (code, reason) => {
        if (closed || failoverInProgress) return;
        if (!semanticOutputSeen && turnFrames.length > 0) {
          failoverInProgress = true;
          await leaseAction("failure", {
            leaseId: lease.leaseId,
            status: 502,
            error: `WebSocket closed before semantic output (${code})`,
          }).catch(() => {});
          await cleanupLease();
          try {
            const next = await acquireConnected(request, excluded, model);
            excluded.push(next.lease.connectionId);
            lease = next.lease;
            upstream = next.upstream;
            await leaseAction("validate-model", { leaseId: lease.leaseId, model });
            bindUpstreamEvents();
            for (const frame of turnFrames) {
              sendWithBackpressure(upstream, frame.data, { binary: false, compress: frame.compress }, client);
            }
            failoverInProgress = false;
            return;
          } catch (error) {
            failoverInProgress = false;
          }
        } else if (semanticOutputSeen) {
          await leaseAction("failure", {
            leaseId: lease.leaseId,
            status: 502,
            error: `WebSocket closed after semantic output (${code})`,
          }).catch(() => {});
        }
        closeBoth(relayCloseCode(code, 1011), reason?.toString() || "Upstream WebSocket closed");
      });
      boundUpstream.on("error", () => {
        // The close handler owns retry/no-replay decisions.
      });
    }

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        closeBoth(1003, "Binary Codex frames are not supported");
        return;
      }
      const frame = { data, compress: true };
      if (!validated) {
        if (validating) queued.push(frame);
        else validateAndFlush(frame);
        return;
      }
      const event = parse(data);
      if (event?.type === "response.create") {
        semanticOutputSeen = false;
        turnFrames.length = 0;
      }
      turnFrames.push(frame);
      sendWithBackpressure(upstream, data, { binary: false, compress: true }, client);
    });
    client.on("close", (code, reason) => {
      if (closed) return;
      closed = true;
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(relayCloseCode(code), reason);
      }
      cleanupLease();
    });
    client.on("error", () => closeBoth(1011, "Client WebSocket failed"));
    client.on("ping", (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.ping(data);
    });
    client.on("pong", (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.pong(data);
    });
    bindUpstreamEvents();
  });

  // Register the gateway first. Callers should wrap later upgrade listeners so
  // Next.js only receives unclaimed paths.
  server.on("upgrade", handleUpgrade);
  return {
    path: NATIVE_PATH,
    handles: isNativeUpgrade,
    close: () => wss.close(),
    handleUpgrade,
    wss,
  };
}

module.exports = {
  NATIVE_PATH,
  attachCodexNativeGateway,
  isNativeUpgrade,
  noProxyMatches,
  proxyAgent,
  safeHandshakeHeaders,
  semanticEvent,
  sendWithBackpressure,
};
