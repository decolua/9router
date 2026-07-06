/**
 * Centralized Crash Logger for 9Router
 * 
 * Provides global uncaughtException / unhandledRejection handlers
 * and writes detailed crash reports to ~/.9router/crash.log
 * 
 * This is the primary mechanism to finally get visibility when the
 * process dies silently on Ubuntu (OOM, uncaught child errors, etc.).
 * 
 * Usage:
 *   import { initCrashLogger } from "@/lib/crashLogger.js";
 *   initCrashLogger();   // Call as early as possible
 */

import fs from "fs";
import path from "path";
import os from "os";

let initialized = false;
const CRASH_LOG_PATH = path.join(
  process.env.DATA_DIR || 
  (process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router")),
  "crash.log"
);

function ensureDir(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {}
}

function safeStringify(obj, maxLen = 8000) {
  try {
    const str = JSON.stringify(obj, (key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Error) return { message: value.message, stack: value.stack };
      return value;
    }, 2);
    return str.length > maxLen ? str.slice(0, maxLen) + "…[truncated]" : str;
  } catch {
    return "[unserializable]";
  }
}

function getRecentConsoleLogs(maxLines = 30) {
  try {
    // Try to read from the patched consoleLogBuffer if it exists
    const mod = globalThis.__consoleLogBuffer || require?.cache?.[require?.resolve?.("./consoleLogBuffer.js")];
    if (mod?.exports?.getRecentLogs) {
      return mod.exports.getRecentLogs(maxLines);
    }
    // Fallback: try global
    if (global.__consoleLogBuffer?.getRecentLogs) {
      return global.__consoleLogBuffer.getRecentLogs(maxLines);
    }
  } catch {}
  return [];
}

function writeCrashReport(type, error, extra = {}) {
  ensureDir(CRASH_LOG_PATH);

  const timestamp = new Date().toISOString();
  const mem = process.memoryUsage();
  const recentLogs = getRecentConsoleLogs(25);

  const report = {
    timestamp,
    type,                    // "uncaughtException" | "unhandledRejection" | "manual"
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version,
    bunVersion: process.versions?.bun || null,
    error: {
      message: error?.message || String(error),
      stack: error?.stack || new Error().stack,
      ...(error && typeof error === "object" ? { name: error.name } : {}),
    },
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + " MB",
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + " MB",
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + " MB",
      external: Math.round(mem.external / 1024 / 1024) + " MB",
    },
    recentConsoleLogs: recentLogs,
    extra,
    cwd: process.cwd(),
  };

  const line = `[${timestamp}] [${type}] ${JSON.stringify(report)}\n`;

  try {
    fs.appendFileSync(CRASH_LOG_PATH, line, { encoding: "utf8", flag: "a" });
  } catch (writeErr) {
    // Last resort: stderr
    console.error("[crashLogger] Failed to write crash.log:", writeErr);
    console.error("[crashLogger] Crash details:", safeStringify(report));
  }

  // Also always print to stderr so it appears in journalctl / docker logs
  console.error(`\n=== 9ROUTER CRASH [${type}] ===`);
  console.error(`Time: ${timestamp}`);
  console.error(`PID: ${process.pid}`);
  console.error(`Memory RSS: ${report.memory.rss}`);
  console.error(error?.stack || error);
  console.error("Crash log written to:", CRASH_LOG_PATH);
  console.error("===========================\n");
}

/**
 * Initialize global crash handlers.
 * Safe to call multiple times (idempotent).
 */
export function initCrashLogger() {
  if (initialized) return;
  initialized = true;

  process.on("uncaughtException", (err) => {
    writeCrashReport("uncaughtException", err);
    // We still let the process die (as per original behavior), but now we have a record.
    // Do NOT process.exit here — let the default handler run so we don't mask issues.
  });

  process.on("unhandledRejection", (reason, promise) => {
    writeCrashReport("unhandledRejection", reason || new Error("Unhandled rejection"), {
      promise: String(promise),
    });
  });

  // Also expose a manual trigger (useful for testing or from signal handlers)
  global.__logCrash = (type = "manual", error = new Error("Manual crash log"), extra = {}) => {
    writeCrashReport(type, error, extra);
  };

  // Best-effort: also log on beforeExit if we have an abnormal exit code
  process.on("beforeExit", (code) => {
    if (code !== 0) {
      try {
        writeCrashReport("beforeExit", new Error(`Process exiting with code ${code}`), { exitCode: code });
      } catch {}
    }
  });

  console.log(`[crashLogger] Global handlers registered. Crashes will be logged to: ${CRASH_LOG_PATH}`);
}

export const CRASH_LOG_FILE = CRASH_LOG_PATH;

// --- CommonJS compatibility for CLI manager process ---
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    initCrashLogger,
    CRASH_LOG_FILE,
    writeCrashReport, // exposed for advanced use
  };
}