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
const LOCAL_PORT = 443;
const IS_WIN = process.platform === "win32";
const ENABLE_FILE_LOG = IS_DEV;

// Verbose request-routing trace. Enabled by MITM_KIRO_DEBUG so we can see WHY a
// Kiro request never reaches the intercept handler (wrong host match, not
// classified as chat, model not mapped → silent passthrough, etc.). This fires
// at the very top of the request handler, before any branch decision.
function kiroDbgEnabled() {
  const v = (process.env.MITM_KIRO_DEBUG || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
function routeDbg(msg) {
  if (kiroDbgEnabled()) log(`[route] ${msg}`);
}

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

// ── SSL / SNI ─────────────────────────────────────────────────

const certCache = new Map();
let rootCAPem;

function sniDbgEnabled() {
  const v = (process.env.MITM_KIRO_DEBUG || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function sniCallback(servername, cb) {
  try {
    if (sniDbgEnabled()) log(`[sni] ClientHello servername=${servername || "-"}`);
    if (certCache.has(servername)) return cb(null, certCache.get(servername));
    const certData = getCertForDomain(servername);
    if (!certData) {
      if (sniDbgEnabled()) err(`[sni] getCertForDomain returned null for ${servername}`);
      return cb(new Error(`Failed to generate cert for ${servername}`));
    }
    const ctx = require("tls").createSecureContext({
      key: certData.key,
      cert: `${certData.cert}\n${rootCAPem}`
    });
    certCache.set(servername, ctx);
    if (sniDbgEnabled()) log(`[sni] cert ready for ${servername}`);
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
  sslOptions = {
    key: rootKey,
    cert: rootCert,
    SNICallback: sniCallback,
    // This is an HTTP/1.1 server (https.createServer). Advertise http/1.1 via ALPN
    // so an HTTP/2-capable client (which offers "h2,http/1.1") cleanly selects 1.1
    // instead of negotiating h2 and then hanging (a cause of TLS ECONNRESET).
    ALPNProtocols: ["http/1.1"],
  };
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

function collectBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
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
async function passthrough(req, res, bodyBuffer, onResponse) {
  const originalHost = (req.headers.host || TARGET_HOSTS[0]).split(":")[0];
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
      return await passthroughHttp2(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper);
    }
  } catch (e) {
    err(`[mitm] ALPN negotiate failed: ${e.message}, fallback to HTTP/1.1`);
  }

  return passthroughHttps(req, res, bodyForForwarding, headersForForwarding, targetHost, onResponse, dumper);
}

// ── ALPN negotiation cache ────────────────────────────────────
const alpnCache = new Map(); // host → "h2" | "http/1.1"
async function negotiateAlpn(host) {
  if (alpnCache.has(host)) return alpnCache.get(host);
  const ip = await resolveTargetIP(host);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: ip, port: 443, servername: host,
      ALPNProtocols: ["h2", "http/1.1"], rejectUnauthorized: false,
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
async function passthroughHttp2(req, res, bodyBuffer, headers, targetHost, onResponse, dumper) {
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
        ALPNProtocols: ["h2"], rejectUnauthorized: false,
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
        if (onResponse) try { onResponse(Buffer.concat(chunks), outHeaders); } catch {}
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
async function passthroughHttps(req, res, bodyBuffer, headers, targetHost, onResponse, dumper) {
  const targetIP = await resolveTargetIP(targetHost);
  const forwardReq = https.request({
    hostname: targetIP,
    port: 443,
    path: req.url,
    method: req.method,
    headers,
    servername: targetHost,
    rejectUnauthorized: false
  }, (forwardRes) => {
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
      if (onResponse) try { onResponse(Buffer.concat(chunks), forwardRes.headers); } catch { /* ignore */ }
    });
  });

  forwardReq.on("error", (e) => {
    err(`Passthrough error: ${e.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${e.message}\n`); dumper.end(); }
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

// ── Request handler ───────────────────────────────────────────

const server = https.createServer(sslOptions, async (req, res) => {
  try {
    if (req.url === "/_mitm_health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    const bodyBuffer = await collectBodyRaw(req);
    if (ENABLE_FILE_LOG) dumpRequest(req, bodyBuffer, "raw");

    const host = (req.headers.host || "").split(":")[0];
    routeDbg(`${req.method} host=${host} url=${req.url} bytes=${bodyBuffer.length} ` +
      `x-amz-target=${req.headers["x-amz-target"] || "-"} ` +
      `x-request-source=${req.headers[INTERNAL_REQUEST_HEADER.name] || "-"}`);

    // Anti-loop: skip requests from 9Router
    if (req.headers[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
      routeDbg("→ passthrough (internal 9Router request, anti-loop)");
      return passthrough(req, res, bodyBuffer);
    }

    const tool = getToolForHost(req.headers.host);
    if (!tool) {
      routeDbg(`→ passthrough (no tool matched for host=${host})`);
      return passthrough(req, res, bodyBuffer);
    }
    routeDbg(`tool=${tool}`);

    // Kiro IDE posts chat to `/` with x-amz-target (not path /generateAssistantResponse)
    if (!isChatRequest(tool, req)) {
      routeDbg(`→ passthrough (not a chat request for tool=${tool}; url=${req.url} x-amz-target=${req.headers["x-amz-target"] || "-"})`);
      return passthrough(req, res, bodyBuffer);
    }

    // Cursor uses binary proto — model extraction not possible at this layer.
    // Delegate directly to handler which decodes proto internally.
    if (tool === "cursor") {
      return handlers[tool].intercept(req, res, bodyBuffer, null, passthrough);
    }

    const model = extractModel(req.url, bodyBuffer);
    routeDbg(`extracted model=${model ?? "null"}`);

    // Intentional passthrough: some models must never be re-routed (e.g. Antigravity
    // tab-autocomplete) so latency-critical inline completion stays native. Silent — this
    // is by design, not a leak, and fires per keystroke. See MODEL_NO_MAP in config.js.
    if (model && (MODEL_NO_MAP[tool] || []).some((re) => re.test(model))) {
      routeDbg(`→ passthrough (model=${model} in MODEL_NO_MAP for tool=${tool})`);
      return passthrough(req, res, bodyBuffer);
    }

    const mappedModel = getMappedModel(tool, model);
    if (!mappedModel) {
      routeDbg(`→ passthrough (no mitmAlias mapping for tool=${tool} model=${model}). ` +
        `Check the tool's MITM alias table in the dashboard.`);
      return passthrough(req, res, bodyBuffer);
    }
    routeDbg(`→ intercept tool=${tool} model=${model} → mappedModel=${mappedModel}`);

    return handlers[tool].intercept(req, res, bodyBuffer, mappedModel, passthrough);
  } catch (e) {
    err(`Unhandled error: ${e.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "mitm_error" } }));
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
  killPort(LOCAL_PORT);
} catch (e) {
  err(`Cannot kill process on port ${LOCAL_PORT}: ${e.message}`);
  process.exit(1);
}

server.listen(LOCAL_PORT, () => log(`🚀 Server ready on :${LOCAL_PORT}`));

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") err(`Port ${LOCAL_PORT} already in use`);
  else if (e.code === "EACCES") err(`Permission denied for port ${LOCAL_PORT}`);
  else err(e.message);
  process.exit(1);
});

// TLS handshake failures never reach the request handler — so if Kiro rejects
// our MITM cert (untrusted CA, SNI mismatch, protocol error), the symptom is a
// Kiro "internal error" with ZERO request logs. Surface those here so the root
// cause is visible. Gated by MITM_KIRO_DEBUG to avoid noise from routine probes.
server.on("tlsClientError", (e, socket) => {
  if (!kiroDbgEnabled()) return;
  const peer = socket && socket.remoteAddress ? `${socket.remoteAddress}:${socket.remotePort}` : "?";
  err(`[tls] handshake failed from ${peer}: ${e.code || ""} ${e.message}`);
});

server.on("clientError", (e, socket) => {
  if (kiroDbgEnabled()) err(`[client] connection error: ${e.code || ""} ${e.message}`);
  try {
    if (socket.writable && !socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch { /* ignore */ }
});

// Log every accepted TLS connection + SNI so we can confirm Kiro is actually
// connecting through the MITM (vs bypassing it entirely).
server.on("secureConnection", (tlsSocket) => {
  if (!kiroDbgEnabled()) return;
  const peer = `${tlsSocket.remoteAddress || "?"}:${tlsSocket.remotePort || "?"}`;
  log(`[tls] connected servername=${tlsSocket.servername || "-"} alpn=${tlsSocket.alpnProtocol || "-"} from ${peer}`);
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
