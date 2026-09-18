const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");
const { LOG_BLACKLIST_URL_PARTS } = require("./config");

function time() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const log = (msg) => console.log(`[${time()}] [MITM] ${msg}`);
const err = (msg) => console.error(`[${time()}] ❌ [MITM] ${msg}`);

const DUMP_DIR = path.join(DATA_DIR, "logs", "mitm");
if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });

// Clear all files inside DUMP_DIR (called on MITM server start to avoid unbounded growth)
function clearDumpDir() {
  try {
    if (!fs.existsSync(DUMP_DIR)) return;
    for (const f of fs.readdirSync(DUMP_DIR)) {
      try { fs.rmSync(path.join(DUMP_DIR, f), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

const SENSITIVE_HEADER_RE = /authorization|api[-_]?key|cookie|token|credential|secret/i;

function slugify(s, max = 80) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").substring(0, max);
}

function isBlacklisted(url) {
  if (!url) return false;
  return LOG_BLACKLIST_URL_PARTS.some(part => url.includes(part));
}

function safeUrl(url) {
  if (!url) return "";
  try { return new URL(url, "https://mitm.local").pathname; } catch { return String(url).split("?")[0]; }
}

function maskSensitiveHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    SENSITIVE_HEADER_RE.test(key) ? "[REDACTED]" : value
  ]));
}

function bodyMetadata(body) {
  const bytes = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body || ""), "utf8");
  return { present: bytes > 0, bytes };
}

// Save request metadata without payload content.
function dumpRequest(req, bodyBuffer, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const url = safeUrl(req.url);
    const slug = slugify((req.headers?.host || "") + url);
    const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.req.json`);
    fs.writeFileSync(file, JSON.stringify({
      method: req.method,
      url,
      host: req.headers?.host,
      headers: maskSensitiveHeaders(req.headers),
      body: bodyMetadata(bodyBuffer)
    }, null, 2));
    return file;
  } catch { return null; }
}

// Response dumper — records response metadata without retaining stream content.
function createResponseDumper(req, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const url = safeUrl(req.url);
  const slug = slugify((req.headers?.host || "") + url);
  const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.res.txt`);
  let status = 0;
  let headers = {};
  let responseBytes = 0;
  return {
    writeHeader: (s, h) => { status = s; headers = h || {}; },
    writeChunk: (chunk) => {
      if (chunk == null) return;
      responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), "utf8");
    },
    end: () => {
      try {
        const out = `STATUS: ${status}\nURL: ${url}\nHEADERS: ${JSON.stringify(maskSensitiveHeaders(headers), null, 2)}\n---BODY-METADATA---\n${JSON.stringify({ present: responseBytes > 0, bytes: responseBytes })}`;
        fs.writeFileSync(file, out);
      } catch { /* ignore */ }
    },
    file
  };
}

module.exports = { log, err, dumpRequest, createResponseDumper, clearDumpDir };
