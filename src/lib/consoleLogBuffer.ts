import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const consoleLevels = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleLevel = typeof consoleLevels[number];

interface ConsoleLogBufferState {
  logs: string[];
  patched: boolean;
  originals: Partial<Record<ConsoleLevel, (...args: any[]) => void>>;
  emitter: EventEmitter;
}

if (!(global as any)._consoleLogBufferState) {
  (global as any)._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  (global as any)._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state: ConsoleLogBufferState = (global as any)._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

function toLogLine(level: string, args: any[]) {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string) {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg: any) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

function appendLine(line: string) {
  state.logs.push(line);
  const maxLines = (CONSOLE_LOG_CONFIG as any).maxLines || 1000;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  state.emitter.emit("line", line);
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args: any[]) => {
      appendLine(toLogLine(level, args));
      state.originals[level]!(...args);
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
