import https from "https";
import fs from "fs";
import path from "path";
import dns from "dns";
import { promisify } from "util";
import { execSync } from "child_process";
import { log, err } from "./logger";
import { TARGET_HOSTS, URL_PATTERNS, getToolForHost } from "./config";
import { DATA_DIR, MITM_DIR } from "./paths";
import { getCertForDomain } from "./cert/generate";
import type { IncomingMessage, ServerResponse } from "http";

const DB_FILE = path.join(DATA_DIR, "db.json");
const LOCAL_PORT = 443;
const ENABLE_FILE_LOG = false;
const LOG_DIR = path.join(DATA_DIR, "logs", "mitm");
const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

if (ENABLE_FILE_LOG && !fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Load handlers — dev/ overrides handlers/ for private implementations
function loadHandler(name: string): any {
  try { return require(`./dev/${name}`); } catch {}
  return require(`./handlers/${name}`);
}

const handlers: Record<string, any> = {
  antigravity: loadHandler("antigravity"),
  copilot: loadHandler("copilot"),
  kiro: loadHandler("kiro"),
  cursor: loadHandler("cursor"),
};

// ── SSL / SNI ─────────────────────────────────────────────────

const certCache = new Map<string, any>();

function sniCallback(servername: string, cb: (err: Error | null, ctx?: any) => void) {
  try {
    if (certCache.has(servername)) return cb(null, certCache.get(servername));
    const certData = getCertForDomain(servername);
    if (!certData) return cb(new Error(`Failed to generate cert for ${servername}`));
    const ctx = require("tls").createSecureContext({ key: certData.key, cert: certData.cert });
    certCache.set(servername, ctx);
    log(`🔐 Cert generated: ${servername}`);
    cb(null, ctx);
  } catch (e: any) {
    err(`SNI error for ${servername}: ${e.message}`);
    cb(e);
  }
}

let sslOptions: any;
try {
  sslOptions = {
    key: fs.readFileSync(path.join(MITM_DIR, "rootCA.key")),
    cert: fs.readFileSync(path.join(MITM_DIR, "rootCA.crt")),
    SNICallback: sniCallback
  };
} catch (e: any) {
  err(`Root CA not found: ${e.message}`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────

const cachedTargetIPs: Record<string, { ip: string; ts: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTargetIP(hostname: string): Promise<string> {
  const cached = cachedTargetIPs[hostname];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ip;
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8"]);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const addresses = await resolve4(hostname);
  cachedTargetIPs[hostname] = { ip: addresses[0], ts: Date.now() };
  return cachedTargetIPs[hostname].ip;
}

function collectBodyRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Extract model from URL path (Gemini), body (OpenAI/Anthropic), or Kiro conversationState
function extractModel(url: string, body: Buffer): string | null {
  const urlMatch = url.match(/\/models\/([^/:]+)/);
  if (urlMatch) return urlMatch[1];
  try {
    const parsed = JSON.parse(body.toString());
    if (parsed.conversationState) {
      return parsed.conversationState.currentMessage?.userInputMessage?.modelId || null;
    }
    return parsed.model || null;
  } catch { return null; }
}

function getMappedModel(tool: string, model: string | null): string | null {
  if (!model) return null;
  try {
    if (!fs.existsSync(DB_FILE)) return null;
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    const aliases = db.mitmAlias?.[tool];
    if (!aliases) return null;
    if (aliases[model]) return aliases[model];
    // Prefix match fallback
    const prefixKey = Object.keys(aliases).find(k => k && aliases[k] && (model.startsWith(k) || k.startsWith(model)));
    return prefixKey ? aliases[prefixKey] : null;
  } catch { return null; }
}

function saveRequestLog(url: string, bodyBuffer: Buffer): void {
  if (!ENABLE_FILE_LOG) return;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = url.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 60);
    const body = JSON.parse(bodyBuffer.toString());
    fs.writeFileSync(path.join(LOG_DIR, `${ts}_${slug}.json`), JSON.stringify(body, null, 2));
  } catch { /* ignore */ }
}

/**
 * Forward request to real upstream.
 * Optional onResponse(rawBuffer) callback — if provided, tees the response
 * so it's both forwarded to client AND passed to the callback for inspection.
 */
async function passthrough(req: IncomingMessage, res: ServerResponse, bodyBuffer: Buffer, onResponse?: (buf: Buffer, headers: any) => void): Promise<void> {
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
    res.writeHead(forwardRes.statusCode || 200, forwardRes.headers);

    if (!onResponse) {
      forwardRes.pipe(res);
      return;
    }

    // Tee: forward to client AND buffer for callback
    const chunks: Buffer[] = [];
    forwardRes.on("data", (chunk: Buffer) => { chunks.push(chunk); res.write(chunk); });
    forwardRes.on("end", () => {
      res.end();
      try { onResponse(Buffer.concat(chunks), forwardRes.headers); } catch { /* ignore */ }
    });
  });

  forwardReq.on("error", (e: any) => {
    err(`Passthrough error: ${e.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

// ── Request handler ───────────────────────────────────────────

const server = https.createServer(sslOptions, async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.url === "/_mitm_health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    const bodyBuffer = await collectBodyRaw(req);
    if (bodyBuffer.length > 0) saveRequestLog(req.url || "", bodyBuffer);

    // Anti-loop: skip requests from 8Router
    if (req.headers[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
      return passthrough(req, res, bodyBuffer);
    }

    const tool = getToolForHost(req.headers.host);
    if (!tool) return passthrough(req, res, bodyBuffer);

    const patterns = URL_PATTERNS[tool] || [];
    const isChat = patterns.some(p => (req.url || "").includes(p));
    if (!isChat) return passthrough(req, res, bodyBuffer);

    log(`🔍 [${tool}] url=${req.url} | bodyLen=${bodyBuffer.length}`);

    // Cursor uses binary proto — model extraction not possible at this layer.
    // Delegate directly to handler which decodes proto internally.
    if (tool === "cursor") {
      log(`⚡ intercept | cursor | proto`);
      return handlers[tool].intercept(req, res, bodyBuffer, null, passthrough);
    }

    const model = extractModel(req.url || "", bodyBuffer);
    log(`🔍 [${tool}] model="${model}"`);

    const mappedModel = getMappedModel(tool, model);
    if (!mappedModel) {
      log(`⏩ passthrough | no mapping | ${tool} | ${model || "unknown"}`);
      return passthrough(req, res, bodyBuffer);
    }

    log(`⚡ intercept | ${tool} | ${model} → ${mappedModel}`);
    return handlers[tool].intercept(req, res, bodyBuffer, mappedModel, passthrough);
  } catch (e: any) {
    err(`Unhandled error: ${e.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "mitm_error" } }));
  }
});

// Kill only processes LISTENING on LOCAL_PORT (not outbound connections)
function killPort(port: number): void {
  try {
    const pids = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf-8", windowsHide: true }).trim();
    if (!pids) return;
    const pidList = pids.split("\n").filter(p => p && Number(p) !== process.pid);
    if (pidList.length === 0) return;
    pidList.forEach(pid => {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch (e: any) {
        err(`Failed to kill PID ${pid}: ${e.message}`);
        throw e;
      }
    });
    log(`Killed ${pidList.length} process(es) on port ${port}`);
  } catch (e: any) {
    if (e.status !== 1) throw e;
  }
}

try {
  killPort(LOCAL_PORT);
} catch (e: any) {
  err(`Cannot kill process on port ${LOCAL_PORT}: ${e.message}`);
  process.exit(1);
}

server.listen(LOCAL_PORT, () => log(`🚀 Server ready on :${LOCAL_PORT}`));

server.on("error", (e: any) => {
  if (e.code === "EADDRINUSE") err(`Port ${LOCAL_PORT} already in use`);
  else if (e.code === "EACCES") err(`Permission denied for port ${LOCAL_PORT}`);
  else err(e.message);
  process.exit(1);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.platform === "win32") process.on("SIGBREAK", shutdown);
