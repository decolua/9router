import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";
import { maskSecrets } from "@/lib/sanitizer.js";

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

function toLogLine(level, args) {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const BEARER_TOKEN_RE = /\bBearer\s+[^\s,;"')\]}]+/gi;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

function maskBearerTokens(str) {
  return str.replace(BEARER_TOKEN_RE, "Bearer ********");
}

function sanitizeArg(arg) {
  if (typeof arg === "string") return maskBearerTokens(arg);
  if (arg instanceof Error) {
    const sanitized = new Error(maskBearerTokens(arg.message || ""));
    sanitized.name = arg.name;
    sanitized.stack = arg.stack ? maskBearerTokens(arg.stack) : arg.stack;
    return sanitized;
  }
  if (arg && typeof arg === "object") return maskSecrets(arg);
  return arg;
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
  state.emitter.emit("line", line);
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(toLogLine(level, args.map(sanitizeArg)));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.logs;
}

export function clearConsoleLogs() {
  state.logs = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
