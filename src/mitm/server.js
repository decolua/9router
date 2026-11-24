const https = require("https");
const http2 = require("http2");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { promisify } = require("util");
const { execSync } = require("child_process");
const { log, err, dumpRequest, createResponseDumper, clearDumpDir } = require("./logger");
const { IS_DEV, LSOF_BIN, TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, MODEL_NO_MAP, getToolForHost, isChatRequest, extractModel } = require("./config");
const { DATA_DIR, MITM_DIR } = require("./paths");
const { generateCert, getCertForDomain } = require("./cert/generate");
const { getMitmAlias } = require("./dbReader");
const { applyAntigravityIdeVersionOverride } = require("./antigravityIdeVersion");
const { createAntigravityObserver } = require("./antigravityAudit");
const { loadPolicy, resolveTarget, rewriteManagementResponse } = require("./antigravityByok");
const { relayBufferedResponse } = require("./bufferedResponse");
const LOCAL_PORT = 443;
const BYOK_FEATURE_MARKER = "antigravity-byok-v1";
const DEFAULT_BYOK_POLICY_FILE = path.join(MITM_DIR, "antigravity-byok.json");
const BYOK_POLICY = process.env.ANTIGRAVITY_BYOK_CONFIG
  ? loadPolicy(process.env.ANTIGRAVITY_BYOK_CONFIG)
  : (fs.existsSync(DEFAULT_BYOK_POLICY_FILE) ? loadPolicy(DEFAULT_BYOK_POLICY_FILE) : null);
const LOCAL_HOST = process.env.MITM_BIND_HOST || (BYOK_POLICY ? "127.0.0.1" : undefined);
if (BYOK_POLICY && !["127.0.0.1", "::1"].includes(LOCAL_HOST)) {
  throw new Error("BYOK MITM must bind to a loopback address");
}
const BYOK_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const BYOK_REQUEST_TIMEOUT_MS = 30000;
const BYOK_MANAGEMENT_PATHS = new Set([
  "/v1internal:loadCodeAssist", "/v1internal:fetchAvailableModels",
  "/v1internal:retrieveUserQuotaSummary", "/v1internal:listExperiments",
  "/v1internal:retrieveUserQuota",
  "/v1internal:fetchUserInfo", "/v1internal:fetchAdminControls", "/v1internal:onboardUser",
]);
const IS_WIN = process.platform === "win32";
const ENABLE_FILE_LOG = IS_DEV && !BYOK_POLICY && !process.env.ANTIGRAVITY_BYOK_AUDIT_FILE;

// Clear stale dump files on every MITM start (prevents unbounded disk usage)
clearDumpDir();
const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// Host rewrite for upstream forward: PROD cloudcode-pa is rate-limited (429),
// daily-cloudcode-pa (dev endpoint) accepts same body+token. Same trick as open-sse.
const HOST_REWRITE = {
  "cloudcode-pa.googleapis.com": "daily-cloudcode-pa.googleapis.com",
};

const handlers = {
  antigravity: require("./handlers/antigravity"),
  copilot: require("./handlers/copilot"),
  kiro: require("./handlers/kiro"),
  cursor: require("./handlers/cursor"),
};

function traceDiagnostic(event, details = {}) {
  const file = process.env.ANTIGRAVITY_BYOK_AUDIT_FILE;
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }) + "\n");
  } catch { /* Diagnostics must not affect requests. */ }
}

// ── SSL / SNI ─────────────────────────────────────────────────

const certCache = new Map();
let rootCAPem;

function sniCallback(servername, cb) {
  try {
    if (certCache.has(servername)) return cb(null, certCache.get(servername));
    const certData = getCertForDomain(servername);
    if (!certData) return cb(new Error(`Failed to generate cert for ${servername}`));
    const ctx = require("tls").createSecureContext({
      key: certData.key,
      cert: `${certData.cert}\n${rootCAPem}`
    });
    certCache.set(servername, ctx);
    cb(null, ctx);
  } catch (e) {
    err(`SNI error for ${servername}: ${e.message}`);
    cb(e);
  }
}

let sslOptions;
try {
  if (!fs.existsSync(path.join(MITM_DIR, "rootCA.key")) || !fs.existsSync(path.join(MITM_DIR, "rootCA.crt"))) {
    log("Root CA missing, generating...");
    generateCert();
  }

  const rootKey = fs.readFileSync(path.join(MITM_DIR, "rootCA.key"));
  const rootCert = fs.readFileSync(path.join(MITM_DIR, "rootCA.crt"));
  rootCAPem = rootCert.toString("utf8");
  sslOptions = { key: rootKey, cert: rootCert, SNICallback: sniCallback };
} catch (e) {
  err(`Root CA not found: ${e.message}`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────

const cachedTargetIPs = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTargetIP(hostname) {
  const cached = cachedTargetIPs[hostname];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ip;
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8"]);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const addresses = await resolve4(hostname);
  cachedTargetIPs[hostname] = { ip: addresses[0], ts: Date.now() };
  return cachedTargetIPs[hostname].ip;
}

function collectBodyRaw(req, limits = null) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    if (!limits) {
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
      return;
    }
    let bytes = 0;
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
      req.removeListener("close", onClose);
    };
    const fail = code => {
      if (settled) return;
      settled = true;
      cleanup();
      // IncomingMessage can emit an error after abort/close. Keep only a
      // temporary sink until the request closes, avoiding an unhandled error.
      const ignoreError = () => {};
      req.on("error", ignoreError);
      req.once("close", () => req.removeListener("error", ignoreError));
      const error = new Error("BYOK request body unavailable");
      error.code = code;
      reject(error);
    };
    const onData = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limits.maxBytes) return fail("BYOK_BODY_TOO_LARGE");
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, bytes));
    };
    const onError = () => fail("BYOK_BODY_ABORTED");
    const onAborted = () => fail("BYOK_BODY_ABORTED");
    const onClose = () => fail("BYOK_BODY_ABORTED");
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
    req.once("close", onClose);
    timer = setTimeout(() => fail("BYOK_BODY_TIMEOUT"), limits.timeoutMs);
  });
}

function getMappedModel(tool, model) {
  if (!model) return null;
  try {
    const aliases = getMitmAlias(tool);
    if (!aliases) return null;
    // Normalize via synonym map (e.g., public AG names -> backend model ids)
    const normalizedModel = String(model).replace(/^models\//, "");
    const lookup = MODEL_SYNONYMS?.[tool]?.[normalizedModel] || normalizedModel;
    if (aliases[lookup]) return aliases[lookup];
    // Prefix match fallback
    const prefixKey = Object.keys(aliases).find(k => k && aliases[k] && (lookup.startsWith(k) || k.startsWith(lookup)));
    if (prefixKey) return aliases[prefixKey];
    // Pattern fallback: catches AG renamed variants (e.g. deprecated pro IDs → gemini-pro-agent)
    const patterns = MODEL_PATTERNS?.[tool] || [];
    for (const { match, alias } of patterns) {
      if (match.test(lookup) && aliases[alias]) return aliases[alias];
    }
    return null;
  } catch { return null; }
}

/**
 * Forward request to real upstream.
 * Optional onResponse(rawBuffer) callback — if provided, tees the response
 * so it's both forwarded to client AND passed to the callback for inspection.
 * Also tees full stream into a dump file when ENABLE_FILE_LOG is on.
 */
async function passthrough(req, res, bodyBuffer, onResponse, transformResponse) {
  const originalHost = (req.headers.host || TARGET_HOSTS[0]).split(":")[0].toLowerCase().replace(/\.$/, "");
  // Only rewrite host for chat endpoints — daily-cloudcode-pa rejects auth/login requests
  const isChatEndpoint = req.url.includes(":generateContent") || req.url.includes(":streamGenerateContent");
  const targetHost = isChatEndpoint ? (HOST_REWRITE[originalHost] || originalHost) : originalHost;
  const dumper = ENABLE_FILE_LOG ? createResponseDumper(req, "passthrough") : null;

  const tool = getToolForHost(req.headers.host);
  const versionOverride = tool === "antigravity"
    ? applyAntigravityIdeVersionOverride(bodyBuffer, req.headers, req.url)
    : { bodyBuffer, headers: req.headers };
  const bodyForForwarding = versionOverride.bodyBuffer;
  const headersForForwarding = { ...versionOverride.headers, host: targetHost };
  if (bodyForForwarding !== bodyBuffer) {
    headersForForwarding["content-length"] = String(bodyForForwarding.length);
  }

  // ALPN negotiate: try HTTP/2 first (like browsers/mitmweb), fallback HTTP/1.1
  try {
    const proto = await negotiateAlpn(targetHost);
    if (proto === "h2") {
      return await passthroughHttp2(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper, transformResponse);
    }
  } catch (e) {
    err(`[mitm] ALPN negotiate failed: ${e.message}, fallback to HTTP/1.1`);
  }

  return passthroughHttps(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper, transformResponse);
}

// ── ALPN negotiation cache ────────────────────────────────────
const alpnCache = new Map(); // host → "h2" | "http/1.1"
async function negotiateAlpn(host) {
  if (alpnCache.has(host)) return alpnCache.get(host);
  const ip = await resolveTargetIP(host);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: ip, port: 443, servername: host,
      ALPNProtocols: ["h2", "http/1.1"], rejectUnauthorized: true,
    }, () => {
      const proto = socket.alpnProtocol || "http/1.1";
      alpnCache.set(host, proto);
      log(`🔗 [mitm] ALPN ${host} → ${proto}`);
      socket.end();
      resolve(proto);
    });
    socket.once("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(new Error("ALPN timeout")); });
  });
}

// HTTP/2 passthrough using node:http2 native
async function passthroughHttp2(req, res, bodyBuffer, headers, targetHost, onResponse, dumper, transformResponse) {
  const targetIP = await resolveTargetIP(targetHost);
  // HTTP/2 pseudo-headers required; strip HTTP/1.1-only headers
  const h2Headers = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "host" || lk === "connection" || lk === "keep-alive" ||
        lk === "transfer-encoding" || lk === "upgrade" || lk === "proxy-connection") continue;
    h2Headers[lk] = v;
  }
  h2Headers[":method"] = req.method;
  h2Headers[":path"] = req.url;
  h2Headers[":scheme"] = "https";
  h2Headers[":authority"] = targetHost;

  return new Promise((resolve) => {
    const client = http2.connect(`https://${targetHost}`, {
      createConnection: () => tls.connect({
        host: targetIP, port: 443, servername: targetHost,
        ALPNProtocols: ["h2"], rejectUnauthorized: true,
      }),
    });
    client.once("error", (e) => {
      err(`[mitm] http2 client error: ${e.message}`);
      if (dumper) { dumper.writeChunk(`\n[ERROR h2] ${e.message}\n`); dumper.end(); }
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end("Bad Gateway");
      try { client.close(); } catch {}
      resolve();
    });

    const stream = client.request(h2Headers, { endStream: bodyBuffer.length === 0 });
    if (transformResponse) stream.setTimeout(20000, () => stream.destroy(new Error("Management response timeout")));
    if (bodyBuffer.length > 0) stream.end(bodyBuffer);

    stream.once("response", (responseHeaders) => {
      const status = responseHeaders[":status"];
      // Filter pseudo-headers + connection-specific
      const outHeaders = {};
      for (const [k, v] of Object.entries(responseHeaders)) {
        if (k.startsWith(":")) continue;
        if (k === "connection" || k === "keep-alive" || k === "transfer-encoding") continue;
        outHeaders[k] = v;
      }
      if (transformResponse) {
        relayBufferedResponse(stream, res, { status, headers: outHeaders, transform: transformResponse, onResponse, dumper })
          .finally(() => { try { client.close(); } catch {} resolve(); }).catch(() => {});
        return;
      }
      res.writeHead(status, outHeaders);
      if (dumper) dumper.writeHeader(status, outHeaders);

      const chunks = [];
      stream.on("data", chunk => {
        if (dumper) dumper.writeChunk(chunk);
        if (onResponse) chunks.push(chunk);
        res.write(chunk);
      });
      stream.on("end", () => {
        if (dumper) dumper.end();
        if (!res.writableEnded) res.end();
        if (onResponse) try { onResponse(Buffer.concat(chunks), outHeaders, status); } catch {}
        try { client.close(); } catch {}
        resolve();
      });
    });
    stream.once("error", (e) => {
      err(`[mitm] http2 stream error: ${e.message}`);
      if (dumper) { dumper.writeChunk(`\n[ERROR h2-stream] ${e.message}\n`); dumper.end(); }
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end();
      try { client.close(); } catch {}
      resolve();
    });
  });
}

// Fallback: raw https.request HTTP/1.1 with custom DNS (bypasses /etc/hosts MITM loop)
async function passthroughHttps(req, res, bodyBuffer, headers, targetHost, onResponse, dumper, transformResponse) {
  const targetIP = await resolveTargetIP(targetHost);
  const forwardReq = https.request({
    hostname: targetIP,
    port: 443,
    path: req.url,
    method: req.method,
    headers,
    servername: targetHost,
    rejectUnauthorized: true
  }, (forwardRes) => {
    if (transformResponse) {
      relayBufferedResponse(forwardRes, res, { status: forwardRes.statusCode, headers: forwardRes.headers, transform: transformResponse, onResponse, dumper });
      return;
    }
    res.writeHead(forwardRes.statusCode, forwardRes.headers);
    if (dumper) dumper.writeHeader(forwardRes.statusCode, forwardRes.headers);

    if (!onResponse && !dumper) {
      forwardRes.pipe(res);
      return;
    }

    const chunks = [];
    forwardRes.on("data", chunk => {
      if (dumper) dumper.writeChunk(chunk);
      if (onResponse) chunks.push(chunk);
      res.write(chunk);
    });
    forwardRes.on("end", () => {
      if (dumper) dumper.end();
      res.end();
      if (onResponse) try { onResponse(Buffer.concat(chunks), forwardRes.headers, forwardRes.statusCode); } catch { /* ignore */ }
    });
  });

  forwardReq.on("error", (e) => {
    err(`Passthrough error: ${e.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${e.message}\n`); dumper.end(); }
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });
  if (transformResponse) forwardReq.setTimeout(20000, () => forwardReq.destroy(new Error("Management response timeout")));

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

// ── Request handler ───────────────────────────────────────────

const server = https.createServer(sslOptions, async (req, res) => {
  try {
    if (req.url === "/_mitm_health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid, byok: Boolean(BYOK_POLICY), byokPolicyVersion: 1, feature: BYOK_FEATURE_MARKER }));
      return;
    }

    const tool = getToolForHost(req.headers.host);
    if (BYOK_POLICY && !tool) {
      res.writeHead(421, { "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify({ error: { type: "byok_unknown_host", message: "Unknown MITM target in BYOK mode." } }));
      req.resume();
      return;
    }
    let bodyBuffer;
    try {
      bodyBuffer = await collectBodyRaw(req, BYOK_POLICY ? { maxBytes: BYOK_MAX_REQUEST_BYTES, timeoutMs: BYOK_REQUEST_TIMEOUT_MS } : null);
    } catch (error) {
      if (!BYOK_POLICY || !["BYOK_BODY_TOO_LARGE", "BYOK_BODY_TIMEOUT", "BYOK_BODY_ABORTED"].includes(error.code)) throw error;
      const status = error.code === "BYOK_BODY_TOO_LARGE" ? 413 : error.code === "BYOK_BODY_TIMEOUT" ? 408 : 400;
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ error: { type: "byok_request_error", message: "BYOK request body unavailable." } }));
      }
      if (!req.destroyed) req.resume();
      return;
    }
    if (ENABLE_FILE_LOG) dumpRequest(req, bodyBuffer, "raw");

    const byokPolicy = tool === "antigravity" ? BYOK_POLICY : null;

    // BYOK generation must remain fail-closed even with an internal-source header.
    if ((!BYOK_POLICY || (tool && tool !== "antigravity")) && req.headers[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
      return passthrough(req, res, bodyBuffer);
    }

    if (!tool) {
      return passthrough(req, res, bodyBuffer);
    }

    if (tool === "antigravity") {
      const endpoint = (req.url || "").split("?")[0];
      // Only fixed RPC names are recorded, never query strings, headers or bodies.
      if (/^\/v1internal:[A-Za-z]{1,64}$/.test(endpoint)) {
        traceDiagnostic("request", { endpoint });
      }
    }

    const observer = createAntigravityObserver(req);
    const managementPath = (req.url || "").split("?")[0];
    if (byokPolicy && BYOK_MANAGEMENT_PATHS.has(managementPath)) {
      const transform = (raw, headers, status) => {
        const result = rewriteManagementResponse(managementPath, status, headers, raw, byokPolicy);
        traceDiagnostic("byok-management", { endpoint: managementPath, status, changed: result.changed });
        return result;
      };
      return passthrough(req, res, bodyBuffer, observer, transform);
    }
    if (observer) return passthrough(req, res, bodyBuffer, observer, (body, headers) => ({ body, headers }));

    // A diagnostic capture must never accidentally execute a native or mapped turn.
    if (tool === "antigravity" && process.env.ANTIGRAVITY_AUDIT_ONLY === "1" &&
        /:(?:cascade)?(?:stream)?generatecontent/i.test(req.url || "")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Antigravity quota diagnostic capture is active; generation is disabled.", type: "diagnostic_only" } }));
      return;
    }

    if (byokPolicy && /:(?:cascade)?(?:stream)?generatecontent/i.test(req.url || "")) {
      const model = extractModel(req.url, bodyBuffer);
      const target = resolveTarget(byokPolicy, model);
      if (!target) {
        traceDiagnostic("byok-generation-blocked");
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "byok_model_required", message: "Choose a configured BYOK model. Native generation is disabled in this mode." } }));
        return;
      }
      const requestId = require("crypto").randomUUID();
      traceDiagnostic("byok-generation", { requestId, target });
      return handlers.antigravity.intercept(req, res, bodyBuffer, target, {
        disableRawDump: true,
        onResponse(status) { traceDiagnostic("byok-generation-result", { requestId, target, status }); }
      });
    }

    if (byokPolicy) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "byok_unsupported_rpc", message: "This RPC is not enabled in BYOK mode." } }));
      return;
    }

    // Kiro IDE posts chat to `/` with x-amz-target (not path /generateAssistantResponse)
    if (!isChatRequest(tool, req)) return passthrough(req, res, bodyBuffer);

    // Cursor uses binary proto — model extraction not possible at this layer.
    // Delegate directly to handler which decodes proto internally.
    if (tool === "cursor") {
      return handlers[tool].intercept(req, res, bodyBuffer, null, passthrough);
    }

    const model = extractModel(req.url, bodyBuffer);

    // Intentional passthrough: some models must never be re-routed (e.g. Antigravity
    // tab-autocomplete) so latency-critical inline completion stays native. Silent — this
    // is by design, not a leak, and fires per keystroke. See MODEL_NO_MAP in config.js.
    if (model && (MODEL_NO_MAP[tool] || []).some((re) => re.test(model))) {
      return passthrough(req, res, bodyBuffer);
    }

    const mappedModel = getMappedModel(tool, model);
    if (!mappedModel) {
      return passthrough(req, res, bodyBuffer);
    }

    return handlers[tool].intercept(req, res, bodyBuffer, mappedModel, passthrough);
  } catch (e) {
    err(BYOK_POLICY ? "Unhandled BYOK proxy error" : `Unhandled error: ${e.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: BYOK_POLICY ? "BYOK proxy error" : e.message, type: "mitm_error" } }));
  }
});

// Kill only processes LISTENING on LOCAL_PORT (not outbound connections)
function killPort(port) {
  try {
    let pidList = [];
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
        `"Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`;
      const out = execSync(psCmd, { encoding: "utf-8", windowsHide: true }).trim();
      if (!out) return;
      pidList = out.split(/\r?\n/).map(s => s.trim()).filter(p => p && Number(p) !== process.pid && Number(p) > 4);
    } else {
      const out = execSync(`${LSOF_BIN} -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf-8", windowsHide: true }).trim();
      if (!out) return;
      pidList = out.split("\n").filter(p => p && Number(p) !== process.pid);
    }
    if (pidList.length === 0) return;
    pidList.forEach(pid => {
      try {
        if (IS_WIN) execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
        else process.kill(Number(pid), "SIGKILL");
      } catch (e) {
        err(`Failed to kill PID ${pid}: ${e.message}`);
      }
    });
    log(`Killed ${pidList.length} process(es) on port ${port}`);
  } catch (e) {
    if (e.status !== 1) throw e;
  }
}

try {
  if (!BYOK_POLICY && process.env.MITM_SKIP_KILL_PORT !== "1") killPort(LOCAL_PORT);
} catch (e) {
  err(`Cannot kill process on port ${LOCAL_PORT}: ${e.message}`);
  process.exit(1);
}

server.listen(LOCAL_PORT, LOCAL_HOST, () => log(`🚀 Server ready on ${LOCAL_HOST || "*"}:${LOCAL_PORT}`));

server.on("tlsClientError", (error) => {
  traceDiagnostic("tlsClientError", { code: error.code || "TLS_ERROR" });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") err(`Port ${LOCAL_PORT} already in use`);
  else if (e.code === "EACCES") err(`Permission denied for port ${LOCAL_PORT}`);
  else err(e.message);
  process.exit(1);
});

const { removeAllDNSEntriesSync } = require("./dns/dnsConfig");
let isShuttingDown = false;
const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  // Strip tool hosts from /etc/hosts so other apps aren't broken after exit
  removeAllDNSEntriesSync();
  const forceExit = setTimeout(() => process.exit(0), 1500);
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.platform === "win32") process.on("SIGBREAK", shutdown);
