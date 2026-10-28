/**
 * Logging for the ACP agent.
 *
 * stdout carries the JSON-RPC protocol and must NEVER be written to, so every
 * diagnostic goes to stderr (visible in Zed's `dev: open acp logs`) and, when
 * --log <file> is given, to that file.
 */

const fs = require("fs");
const path = require("path");

let logFile = null;

function setLogFile(file) {
  if (!file) return;
  logFile = path.resolve(file);
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  } catch {
    logFile = null;
  }
}

// Server/model-controlled strings end up in logs — strip credentials so a
// request dump can never leak a key (same rule as xaiVideo.sanitizeText).
function redact(text) {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
    .replace(/(sk-[A-Za-z0-9\-]{6})[A-Za-z0-9\-]+/g, "$1[redacted]")
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, "$1[redacted]");
}

function write(line) {
  const safe = redact(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${safe}\n`);
    } catch {
      /* never fail the protocol on logging */
    }
  }
}

function log(...args) {
  write(`[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
}

function error(...args) {
  write(`[${new Date().toISOString()}] ERROR ${args.map((a) => (typeof a === "string" ? a : a?.stack || JSON.stringify(a))).join(" ")}`);
  try {
    process.stderr.write(`${redact(args.map(String).join(" "))}\n`);
  } catch {
    /* ignore */
  }
}

module.exports = { setLogFile, log, error, redact, __test__: { redact } };
