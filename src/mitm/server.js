const https = require("https");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { promisify } = require("util");

const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// All intercepted domains across all tools
const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
];

const LOCAL_PORT = 443;
const ROUTER_URL = "http://localhost:20128/v1/chat/completions";
const API_KEY = process.env.ROUTER_API_KEY;
const { DATA_DIR, MITM_DIR } = require("./paths");
const DB_FILE = path.join(DATA_DIR, "db.json");

const ENABLE_FILE_LOG = false;

if (!API_KEY) {
  console.error("❌ ROUTER_API_KEY required");
  process.exit(1);
}

const { getCertForDomain } = require("./cert/generate");

// Certificate cache for performance
const certCache = new Map();

// SNI callback for dynamic certificate generation
function sniCallback(servername, cb) {
  try {
    // Check cache first
    if (certCache.has(servername)) {
      const cached = certCache.get(servername);
      return cb(null, cached);
    }

    // Generate new cert for this domain
    const certData = getCertForDomain(servername);
    if (!certData) {
      return cb(new Error(`Failed to generate cert for ${servername}`));
    }

    // Create secure context
    const ctx = require("tls").createSecureContext({
      key: certData.key,
      cert: certData.cert
    });

    // Cache it
    certCache.set(servername, ctx);
    console.log(`✅ Generated cert for: ${servername}`);

    cb(null, ctx);
  } catch (error) {
    console.error(`❌ SNI error for ${servername}:`, error.message);
    cb(error);
  }
}

// Load Root CA for default context
const certDir = MITM_DIR;
const rootCAKeyPath = path.join(certDir, "rootCA.key");
const rootCACertPath = path.join(certDir, "rootCA.crt");

let sslOptions;
try {
  sslOptions = {
    key: fs.readFileSync(rootCAKeyPath),
    cert: fs.readFileSync(rootCACertPath),
    SNICallback: sniCallback
  };
} catch (e) {
  console.error(`❌ Root CA not found in ${certDir}: ${e.message}`);
  process.exit(1);
}

// Antigravity: Gemini generateContent endpoints
const ANTIGRAVITY_URL_PATTERNS = [":generateContent", ":streamGenerateContent"];
// Copilot: OpenAI-compatible + Anthropic endpoints
const COPILOT_URL_PATTERNS = ["/chat/completions", "/v1/messages", "/responses"];

const LOG_DIR = path.join(__dirname, "../../logs/mitm");
if (ENABLE_FILE_LOG && !fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function saveRequestLog(url, bodyBuffer) {
  if (!ENABLE_FILE_LOG) return;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const urlSlug = url.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 60);
    const filePath = path.join(LOG_DIR, `${ts}_${urlSlug}.json`);
    const body = JSON.parse(bodyBuffer.toString());
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
  } catch { /* ignore */ }
}

const cachedTargetIPs = {};
async function resolveTargetIP(hostname) {
  if (cachedTargetIPs[hostname]) return cachedTargetIPs[hostname];
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8"]);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const addresses = await resolve4(hostname);
  cachedTargetIPs[hostname] = addresses[0];
  return cachedTargetIPs[hostname];
}

function collectBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Extract model from URL path (Gemini) or body (OpenAI/Anthropic)
function extractModel(url, body) {
  const urlMatch = url.match(/\/models\/([^/:]+)/);
  if (urlMatch) return urlMatch[1];
  try { return JSON.parse(body.toString()).model || null; } catch { return null; }
}

function getMappedModel(tool, model) {
  if (!model) return null;
  try {
    if (!fs.existsSync(DB_FILE)) return null;
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    return db.mitmAlias?.[tool]?.[model] || null;
  } catch {
    return null;
  }
}

/**
 * Determine which tool this request belongs to based on hostname
 */
function getToolForHost(host) {
  const h = (host || "").split(":")[0];
  if (h === "api.individual.githubcopilot.com") return "copilot";
  if (h === "daily-cloudcode-pa.googleapis.com" || h === "cloudcode-pa.googleapis.com") return "antigravity";
  return null;
}

async function passthrough(req, res, bodyBuffer) {
  const targetHost = (req.headers.host || TARGET_HOSTS[0]).split(":")[0];
  const targetIP = await resolveTargetIP(targetHost);

  const forwardReq = https.request({
    hostname: targetIP,
    port: 443,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: targetHost },
    servername: targetHost,
    rejectUnauthorized: false
  }, (forwardRes) => {
    res.writeHead(forwardRes.statusCode, forwardRes.headers);
    forwardRes.pipe(res);
  });

  forwardReq.on("error", (err) => {
    console.error(`❌ Passthrough error: ${err.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

async function intercept(req, res, bodyBuffer, mappedModel) {
  try {
    const body = JSON.parse(bodyBuffer.toString());
    body.model = mappedModel;

    const response = await fetch(ROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`9Router ${response.status}: ${errText}`);
    }

    const ct = response.headers.get("content-type") || "application/json";
    const resHeaders = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
    if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
    res.writeHead(200, resHeaders);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
  }
}

const server = https.createServer(sslOptions, async (req, res) => {
  if (req.url === "/_mitm_health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid }));
    return;
  }

  const bodyBuffer = await collectBodyRaw(req);
  if (bodyBuffer.length > 0) saveRequestLog(req.url, bodyBuffer);

  // Anti-loop: requests originating from 9Router bypass interception
  if (req.headers[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
    return passthrough(req, res, bodyBuffer);
  }

  const tool = getToolForHost(req.headers.host);
  if (!tool) return passthrough(req, res, bodyBuffer);

  // Check if this URL should be intercepted based on tool
  const isChat = tool === "antigravity"
    ? ANTIGRAVITY_URL_PATTERNS.some(p => req.url.includes(p))
    : COPILOT_URL_PATTERNS.some(p => req.url.includes(p));

  if (!isChat) return passthrough(req, res, bodyBuffer);

  const model = extractModel(req.url, bodyBuffer);
  console.log("Extracted model:",  model)
  const mappedModel = getMappedModel(tool, model);

  if (!mappedModel) return passthrough(req, res, bodyBuffer);

  return intercept(req, res, bodyBuffer, mappedModel);
});

server.listen(LOCAL_PORT, () => {
  console.log(`🚀 MITM ready on :${LOCAL_PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${LOCAL_PORT} already in use`);
  } else if (error.code === "EACCES") {
    console.error(`❌ Permission denied for port ${LOCAL_PORT}`);
  } else {
    console.error(`❌ ${error.message}`);
  }
  process.exit(1);
});

const shutdown = () => { server.close(() => process.exit(0)); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.platform === "win32") {
  process.on("SIGBREAK", shutdown);
}
