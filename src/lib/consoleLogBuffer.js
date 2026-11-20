import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

if (!state.pendingLines) state.pendingLines = [];
if (!state.flushTimer) state.flushTimer = null;

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_LINES = 50;

let isPersisting = false;
async function persistLogsToD1(newLines) {
  if (isPersisting) return;
  isPersisting = true;
  try {
    const cfCtx = globalThis[Symbol.for("__cloudflare-context__")];
    if (!cfCtx?.env?.DB) return;
    const { makeKv } = await import("@/lib/db/helpers/kvStore.js");
    const kv = makeKv("system");
    const existing = await kv.get("console_logs", []);
    const updated = [...(Array.isArray(existing) ? existing : []), ...newLines].slice(-CONSOLE_LOG_CONFIG.maxLines);
    await kv.set("console_logs", updated);
  } catch {
  } finally {
    isPersisting = false;
  }
}

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  state.emitter.emit("lines", lines);

  try {
    const cfCtx = globalThis[Symbol.for("__cloudflare-context__")];
    if (cfCtx?.ctx?.waitUntil && cfCtx?.env?.DB) {
      cfCtx.ctx.waitUntil(persistLogsToD1(lines));
    }
  } catch {}
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function toLogLine(level, args) {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

function appendLine(line) {
  state.logs.push(line);
  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  state.pendingLines.push(line);
  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(toLogLine(level, args));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.logs;
}

export async function clearConsoleLogs() {
  state.logs = [];
  state.emitter.emit("clear");
  try {
    const cfCtx = globalThis[Symbol.for("__cloudflare-context__")];
    if (cfCtx?.env?.DB) {
      const { makeKv } = await import("@/lib/db/helpers/kvStore.js");
      const kv = makeKv("system");
      await kv.set("console_logs", []);
      await kv.set("console_cleared_at", Date.now());
    }
  } catch {}
}

export function getConsoleEmitter() {
  return state.emitter;
}
