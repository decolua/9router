"use strict";

const { WebSocket, WebSocketServer } = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { randomUUID } = require("node:crypto");

const NATIVE_PATH = "/v1/codex/responses";
const UPSTREAM_URL = "wss://chatgpt.com/backend-api/codex/responses";
const HIGH_WATER_MARK = 1024 * 1024;
const COMPACTION_METADATA_KEY = "x-codex-turn-metadata";
const HTTP_FALLBACK_BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);
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

function codexRequestIsCompaction(event) {
  const raw = event?.client_metadata?.[COMPACTION_METADATA_KEY];
  if (raw == null || raw === "") return false;
  let metadata = raw;
  if (typeof raw === "string") {
    try {
      metadata = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  return typeof metadata === "object"
    && metadata !== null
    && String(metadata.request_kind || "").trim().toLowerCase() === "compaction";
}

function codexCompactionHttpBody(event) {
  const body = { ...event, stream: true };
  delete body.type;
  return JSON.stringify(body);
}

function compactionHttpHeaders(request) {
  const headers = requestHeaderObject(request);
  for (const name of Object.keys(headers)) {
    if (
      HTTP_FALLBACK_BLOCKED_HEADERS.has(name)
      || name.startsWith("sec-websocket-")
      || name.startsWith("x-9r-")
    ) {
      delete headers[name];
    }
  }
  headers.accept = "text/event-stream";
  headers["content-type"] = "application/json";
  if (headers["openai-beta"]) {
    const betaFeatures = headers["openai-beta"]
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value && !value.toLowerCase().startsWith("responses_websockets="));
    if (betaFeatures.length) headers["openai-beta"] = betaFeatures.join(", ");
    else delete headers["openai-beta"];
  }
  const version = clientVersion(request);
  if (version && !headers["x-codex-client-version"]) {
    headers["x-codex-client-version"] = version;
  }
  return headers;
}

function sseData(record) {
  const values = [];
  for (const line of record.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    let value = line.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    values.push(value);
  }
  return values.join("\n");
}

async function relayHttpEvents(response, onEvent) {
  if (!response.body) return;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    const payload = (await response.text()).trim();
    if (payload) await onEvent(payload);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  const flush = async (final = false) => {
    while (pending) {
      const boundary = pending.match(/\r?\n\r?\n/);
      if (!boundary) {
        if (!final) return;
        const payload = sseData(pending);
        pending = "";
        if (payload && payload !== "[DONE]") await onEvent(payload);
        return;
      }
      const record = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary[0].length);
      const payload = sseData(record);
      if (payload && payload !== "[DONE]") await onEvent(payload);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      await flush(false);
    }
    pending += decoder.decode();
    await flush(true);
    completed = true;
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function websocketErrorPayload(status, rawBody, fallbackMessage) {
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { parsed = null; }
  const source = parsed?.error || parsed;
  return JSON.stringify({
    type: "error",
    status,
    error: {
      type: source?.type || "server_error",
      code: source?.code || "codex_http_compaction_failed",
      message: source?.message || rawBody || fallbackMessage,
    },
  });
}

function websocketFailedPayload(message, code = "codex_http_compaction_failed") {
  return JSON.stringify({
    type: "response.failed",
    response: {
      id: `resp_${Date.now()}`,
      status: "failed",
      error: {
        type: "stream_error",
        code,
        message,
      },
    },
  });
}

function sendText(destination, payload) {
  return new Promise((resolve, reject) => {
    if (!destination || destination.readyState !== WebSocket.OPEN) {
      reject(new Error("Downstream WebSocket is not open"));
      return;
    }
    destination.send(payload, { binary: false, compress: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeUpstreamSocket(socket, code = 1000, reason = "") {
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(relayCloseCode(code), reason);
  } else if (socket.readyState !== WebSocket.CLOSED) {
    socket.terminate?.();
  }
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
    || type === "response.done"
  );
}

function compactionTerminalEvent(event) {
  const type = event?.type;
  return type === "response.completed"
    || type === "response.done"
    || type === "response.failed"
    || type === "response.incomplete"
    || type === "response.cancelled"
    || type === "error"
    || event?.status === "completed"
    || event?.status === "failed"
    || event?.response?.status === "completed"
    || event?.response?.status === "failed";
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

function sendWithBackpressure(destination, data, options, source, closeSourceOnError = true) {
  if (!destination || destination.readyState !== WebSocket.OPEN) return;
  if (destination.bufferedAmount > HIGH_WATER_MARK) source?._socket?.pause?.();
  destination.send(data, options, (error) => {
    if (destination.bufferedAmount <= HIGH_WATER_MARK / 2) source?._socket?.resume?.();
    if (error && closeSourceOnError && source?.readyState === WebSocket.OPEN) {
      source.close(1011, "WebSocket relay failed");
    }
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
  const httpFetchImpl = options.httpFetch || options.fetch || globalThis.fetch;
  const upstreamUrl = options.upstreamUrl || UPSTREAM_URL;
  const httpResponsesUrl = options.httpResponsesUrl
    || `${internalBaseUrl.replace(/\/+$/, "")}${NATIVE_PATH}`;
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
    // Keep the HTTP compaction lease on the same account when a client omits
    // both affinity headers. The synthetic identity is stable for this socket.
    if (!request.headers["session-id"] && !request.headers["thread-id"]) {
      request.headers["session-id"] = `9router-ws-${randomUUID()}`;
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
    let validated = false;
    let semanticOutputSeen = false;
    let turnInProgress = false;
    let closed = false;
    let failoverInProgress = false;
    let httpFallbackInProgress = false;
    let activeHttpAbort = null;
    const pendingCompactions = new Set();
    let activeCompaction = null;
    let upstreamUnavailable = false;
    let allowClosedConnectionRetry = false;
    let failoverPromise = null;
    let frameChain = Promise.resolve();
    const turnFrames = [];
    const excluded = [lease.connectionId];

    const cleanupLease = () => leaseAction("release", { leaseId: lease.leaseId }).catch(() => {});
    const closeBoth = (code = 1000, reason = "") => {
      if (closed) return;
      closed = true;
      activeHttpAbort?.abort();
      const safeCode = relayCloseCode(code, code === 1003 || code === 1008 || code === 1011 ? code : 1000);
      if (client.readyState === WebSocket.OPEN) client.close(safeCode, reason);
      closeUpstreamSocket(upstream, safeCode, reason);
      cleanupLease();
    };

    const parse = (data) => {
      try { return JSON.parse(data.toString()); } catch { return null; }
    };

    async function validateFirstFrame(event) {
      if (!event || event.type !== "response.create" || typeof event.model !== "string") {
        closeBoth(1008, "First Codex frame must be response.create with a model");
        return false;
      }
      model = event.model;
      try {
        try {
          await leaseAction("validate-model", { leaseId: lease.leaseId, model });
        } catch (error) {
          if (error.status !== 409) {
            closeBoth(1008, `Model '${model}' is not available on the leased metadata cohort`);
            return false;
          }

          // The model is only known on response.create. If the handshake lease
          // belongs to another metadata cohort, replace it before sending bytes.
          failoverInProgress = true;
          const previousLeaseId = lease.leaseId;
          const previousUpstream = upstream;
          await leaseAction("release", { leaseId: previousLeaseId }).catch(() => {});
          previousUpstream.removeAllListeners();
          closeUpstreamSocket(previousUpstream);
          if (closed) return false;
          try {
            const next = await acquireConnected(request, excluded, model);
            if (closed) {
              closeUpstreamSocket(next.upstream);
              await leaseAction("release", { leaseId: next.lease.leaseId }).catch(() => {});
              return false;
            }
            excluded.push(next.lease.connectionId);
            lease = next.lease;
            upstream = next.upstream;
            await leaseAction("validate-model", { leaseId: lease.leaseId, model });
            if (closed) {
              closeUpstreamSocket(upstream);
              await leaseAction("release", { leaseId: lease.leaseId }).catch(() => {});
              return false;
            }
            bindUpstreamEvents();
          } catch {
            closeBoth(1008, `Model '${model}' is not available on a WebSocket-capable metadata cohort`);
            return false;
          } finally {
            failoverInProgress = false;
          }
        }

        validated = true;
        return true;
      } catch (error) {
        closeBoth(1011, error.message || "Codex model validation failed");
        return false;
      }
    }

    async function ensureUpstreamConnected() {
      if (closed) return false;
      if (failoverPromise) {
        if (!await failoverPromise) return false;
        if (closed) return false;
        if (!upstreamUnavailable && upstream?.readyState === WebSocket.OPEN) return true;
      }
      if (!upstreamUnavailable && upstream?.readyState === WebSocket.OPEN) return true;
      try {
        const reconnectExcluded = new Set(excluded);
        if (allowClosedConnectionRetry) reconnectExcluded.delete(lease.connectionId);
        const next = await acquireConnected(request, [...reconnectExcluded], model);
        allowClosedConnectionRetry = false;
        if (closed) {
          closeUpstreamSocket(next.upstream);
          await leaseAction("release", { leaseId: next.lease.leaseId }).catch(() => {});
          return false;
        }
        excluded.push(next.lease.connectionId);
        lease = next.lease;
        upstream = next.upstream;
        await leaseAction("validate-model", { leaseId: lease.leaseId, model });
        if (closed) {
          closeUpstreamSocket(upstream);
          await leaseAction("release", { leaseId: lease.leaseId }).catch(() => {});
          return false;
        }
        upstreamUnavailable = false;
        bindUpstreamEvents();
        return true;
      } catch (error) {
        closeBoth(1011, error.message || "Codex WebSocket reconnect failed");
        return false;
      }
    }

    async function relayCompactionOverHttp(event, controller = new AbortController(), frame = null) {
      httpFallbackInProgress = true;
      activeHttpAbort = controller;
      let terminalSeen = false;
      try {
        console.info("[Codex Native] Routing compaction turn over HTTP to avoid WebSocket close 1009");
        const response = await httpFetchImpl(httpResponsesUrl, {
          method: "POST",
          headers: compactionHttpHeaders(request),
          body: codexCompactionHttpBody(event),
          signal: controller.signal,
        });
        if (controller.signal.aborted || closed) return;
        if (!response.ok) {
          const rawBody = (await response.text()).slice(0, 4096);
          if (controller.signal.aborted || closed) return;
          await sendText(client, websocketErrorPayload(
            response.status,
            rawBody,
            `Codex HTTP compaction failed (${response.status})`
          ));
          return;
        }
        await relayHttpEvents(response, async (payload) => {
          const relayed = parse(payload);
          if (compactionTerminalEvent(relayed)) {
            terminalSeen = true;
          }
          if (!closed && !frame?.cancelled) await sendText(client, payload);
        });
        if (!terminalSeen && !controller.signal.aborted && !closed && !frame?.cancelled) {
          await sendText(client, websocketFailedPayload(
            "Codex HTTP compaction ended before a terminal response event"
          )).catch(() => {});
        }
      } catch (error) {
        if (error?.name !== "AbortError" && !closed) {
          await sendText(client, websocketFailedPayload(
            error.message || "Codex HTTP compaction transport failed",
            "codex_http_compaction_transport_error"
          )).catch(() => {});
        }
      } finally {
        if (activeHttpAbort === controller) activeHttpAbort = null;
        httpFallbackInProgress = false;
        if (activeCompaction?.controller === controller) activeCompaction = null;
      }
    }

    async function dispatchClientFrame(frame) {
      if (closed) return;
      const event = parse(frame.data);
      if (!validated && !await validateFirstFrame(event)) return;
      if (closed) return;
      if (event?.type === "response.create") {
        semanticOutputSeen = false;
        turnFrames.length = 0;
        turnInProgress = !codexRequestIsCompaction(event);
      }
      if (event?.type === "response.create" && codexRequestIsCompaction(event)) {
        pendingCompactions.delete(frame);
        if (frame.cancelled || closed) return;
        const controller = new AbortController();
        activeCompaction = { frame, controller };
        await relayCompactionOverHttp(event, controller, frame);
        return;
      }
      if (closed) return;
      if (!await ensureUpstreamConnected()) return;
      if (closed) return;
      turnFrames.push(frame);
      sendWithBackpressure(
        upstream,
        frame.data,
        { binary: false, compress: frame.compress },
        client,
        false
      );
    }

    function bindUpstreamEvents() {
      const boundUpstream = upstream;
      const boundLeaseId = lease.leaseId;
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
          leaseAction("quota-event", { leaseId: boundLeaseId, event }).catch(() => {});
        }
        if (semanticEvent(event)) {
          semanticOutputSeen = true;
          turnFrames.length = 0;
          leaseAction("semantic-output", { leaseId: boundLeaseId }).catch(() => {});
        }
        if (event?.type === "response.completed" || event?.type === "response.done") {
          turnInProgress = false;
          leaseAction("success", { leaseId: boundLeaseId }).catch(() => {});
        } else if ([
          "response.failed",
          "response.incomplete",
          "response.cancelled",
          "error",
        ].includes(event?.type)) {
          turnInProgress = false;
        }
        sendWithBackpressure(client, data, { binary: false, compress: true }, boundUpstream);
      });
      boundUpstream.on("close", async (code, reason) => {
        if (closed || failoverInProgress || boundUpstream !== upstream) return;
        if (code === 1009) {
          closeBoth(1009, reason?.toString() || "WebSocket message too big");
          return;
        }
        if (httpFallbackInProgress) {
          upstreamUnavailable = true;
          allowClosedConnectionRetry = true;
          await cleanupLease();
          return;
        }
        if (!turnInProgress) {
          upstreamUnavailable = true;
          allowClosedConnectionRetry = true;
          await cleanupLease();
          return;
        }
        if (!semanticOutputSeen && turnFrames.length > 0) {
          failoverInProgress = true;
          upstreamUnavailable = true;
          failoverPromise = (async () => {
            await leaseAction("failure", {
              leaseId: lease.leaseId,
              status: 502,
              error: `WebSocket closed before semantic output (${code})`,
            }).catch(() => {});
            await cleanupLease();
            try {
              const next = await acquireConnected(request, excluded, model);
              if (closed) {
                closeUpstreamSocket(next.upstream);
                await leaseAction("release", { leaseId: next.lease.leaseId }).catch(() => {});
                return false;
              }
              excluded.push(next.lease.connectionId);
              lease = next.lease;
              upstream = next.upstream;
              await leaseAction("validate-model", { leaseId: lease.leaseId, model });
              if (closed) {
                closeUpstreamSocket(upstream);
                await leaseAction("release", { leaseId: lease.leaseId }).catch(() => {});
                return false;
              }
              upstreamUnavailable = false;
              bindUpstreamEvents();
              for (const frame of turnFrames) {
                if (closed) return false;
                sendWithBackpressure(
                  upstream,
                  frame.data,
                  { binary: false, compress: frame.compress },
                  client,
                  false
                );
              }
              return true;
            } catch {
              closeUpstreamSocket(upstream);
              await cleanupLease();
              return false;
            }
          })();
          const recovered = await failoverPromise;
          failoverPromise = null;
          failoverInProgress = false;
          if (recovered) return;
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
      const event = parse(data);
      const frame = {
        data,
        compress: true,
        cancelled: false,
      };
      if (event?.type === "response.create" && codexRequestIsCompaction(event)) {
        pendingCompactions.add(frame);
      }
      if (event?.type === "response.cancel" && (activeCompaction || pendingCompactions.size)) {
        const pending = activeCompaction?.frame || [...pendingCompactions].at(-1);
        if (pending) pending.cancelled = true;
        if (activeCompaction?.frame) activeCompaction.frame.cancelled = true;
        activeHttpAbort?.abort();
        sendText(client, websocketFailedPayload(
          "Codex HTTP compaction cancelled",
          "codex_http_compaction_cancelled"
        )).catch(() => {});
        return;
      }
      frameChain = frameChain
        .then(() => dispatchClientFrame(frame))
        .catch((error) => closeBoth(1011, error.message || "Codex frame dispatch failed"));
    });
    client.on("close", (code, reason) => {
      if (closed) return;
      closed = true;
      activeHttpAbort?.abort();
      closeUpstreamSocket(upstream, code, reason);
      cleanupLease();
    });
    client.on("error", () => closeBoth(1011, "Client WebSocket failed"));
    client.on("ping", (data) => {
      if (upstream?.readyState === WebSocket.OPEN) upstream.ping(data);
    });
    client.on("pong", (data) => {
      if (upstream?.readyState === WebSocket.OPEN) upstream.pong(data);
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
  codexCompactionHttpBody,
  codexRequestIsCompaction,
  compactionHttpHeaders,
  isNativeUpgrade,
  noProxyMatches,
  proxyAgent,
  safeHandshakeHeaders,
  semanticEvent,
  sendWithBackpressure,
};
