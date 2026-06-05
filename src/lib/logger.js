/**
 * Structured application logger for 9router.
 *
 * Uses Pino with:
 * - Daily rotating file output (custom, no worker thread — Next standalone safe)
 * - Console output (so consoleLogBuffer / dashboard /console-log still works)
 * - Sensitive field redaction
 * - Child logger factory with scope binding
 *
 * Usage:
 *   import { logger, createLogger } from "@/lib/logger";
 *   logger.info({ provider: "kiro", status: 429 }, "upstream rate limited");
 *   const log = createLogger("auth");
 *   log.warn({ connectionId: "abc123" }, "token refresh failed");
 */

import pino from "pino";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config (env-driven)
// ---------------------------------------------------------------------------

const LOG_DIR = process.env.LOG_DIR || path.join(process.env.HOME || "/tmp", ".9router", "logs");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE_MB || "20", 10) * 1024 * 1024;
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || "7", 10);

// Ensure log directory exists
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch { /* ignore if exists */ }

// ---------------------------------------------------------------------------
// Rotating file stream (custom, no worker thread)
// ---------------------------------------------------------------------------

class RotatingFileStream {
  constructor(dir, prefix = "app") {
    this.dir = dir;
    this.prefix = prefix;
    this.currentDate = null;
    this.stream = null;
    this.bytesWritten = 0;
    this._open();
  }

  _dateStr() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _filePath(date) {
    return path.join(this.dir, `${this.prefix}-${date}.log`);
  }

  _open() {
    const date = this._dateStr();
    this.currentDate = date;
    const filePath = this._filePath(date);
    // Get existing size
    try {
      const stat = fs.statSync(filePath);
      this.bytesWritten = stat.size;
    } catch {
      this.bytesWritten = 0;
    }
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  _rotate() {
    if (this.stream) {
      this.stream.end();
    }
    this._open();
    this._prune();
  }

  _prune() {
    // Remove log files older than retention
    try {
      const files = fs.readdirSync(this.dir)
        .filter(f => f.startsWith(this.prefix + "-") && f.endsWith(".log"))
        .sort();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - LOG_RETENTION_DAYS);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      for (const file of files) {
        const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch && dateMatch[1] < cutoffStr) {
          try {
            fs.unlinkSync(path.join(this.dir, file));
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  write(data) {
    const now = this._dateStr();
    // Rotate on date change or size exceeded
    if (now !== this.currentDate || this.bytesWritten >= LOG_MAX_SIZE) {
      this._rotate();
    }
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    this.bytesWritten += buf.length;
    this.stream.write(buf);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Console bridge stream (so dashboard /console-log captures log lines)
// ---------------------------------------------------------------------------

class ConsoleBridgeStream {
  write(data) {
    const line = typeof data === "string" ? data.trimEnd() : data.toString().trimEnd();
    // Use process.stdout directly to avoid recursion if console is patched
    process.stdout.write(line + "\n");
    return true;
  }
}

// ---------------------------------------------------------------------------
// Pino instance
// ---------------------------------------------------------------------------

const fileStream = new RotatingFileStream(LOG_DIR, "app");
const consoleStream = new ConsoleBridgeStream();

const streams = pino.multistream([
  { level: LOG_LEVEL, stream: fileStream },
  { level: LOG_LEVEL, stream: consoleStream },
]);

export const logger = pino({
  level: LOG_LEVEL,
  redact: {
    paths: [
      "authorization",
      "accessToken",
      "access_token",
      "refreshToken",
      "refresh_token",
      "clientSecret",
      "client_secret",
      "password",
      "token",
      "apiKey",
      "api_key",
      "authToken",
      "auth_token",
      "cookie",
      "secret",
      "*.authorization",
      "*.accessToken",
      "*.access_token",
      "*.refreshToken",
      "*.refresh_token",
      "*.clientSecret",
      "*.client_secret",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.authToken",
      "*.auth_token",
      "*.cookie",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: "9router" },
}, streams);

// ---------------------------------------------------------------------------
// Factory: create scoped child logger
// ---------------------------------------------------------------------------

/**
 * Create a child logger with scope binding.
 * @param {string|object} scope - Scope name or object with bindings
 * @returns {pino.Logger}
 *
 * @example
 *   const log = createLogger("auth");
 *   log.info({ connectionId }, "refreshed");
 *
 *   const log = createLogger({ scope: "chat", provider: "kiro", model });
 *   log.warn({ status: 429 }, "rate limited");
 */
export function createLogger(scope) {
  if (typeof scope === "string") {
    return logger.child({ scope });
  }
  return logger.child(scope);
}

// ---------------------------------------------------------------------------
// Compat: tag-based API matching existing src/sse/utils/logger.js
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for the existing tag-based logger pattern.
 * Returns an object with debug/info/warn/error methods that accept (tag, msg, data).
 */
export function createTagLogger() {
  return {
    debug(tag, msg, data) {
      logger.debug({ tag, ...spreadData(data) }, msg);
    },
    info(tag, msg, data) {
      logger.info({ tag, ...spreadData(data) }, msg);
    },
    warn(tag, msg, data) {
      logger.warn({ tag, ...spreadData(data) }, msg);
    },
    error(tag, msg, data) {
      logger.error({ tag, ...spreadData(data) }, msg);
    },
  };
}

function spreadData(data) {
  if (!data) return {};
  if (typeof data === "string") return { detail: data };
  if (typeof data === "object") return data;
  return { detail: String(data) };
}

export default logger;
