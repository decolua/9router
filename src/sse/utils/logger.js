// SSE logger — structured pino backend + session-colored request tags.
// Kept tag-based API for backward compatibility with existing call sites.

import { logger } from "@/lib/logger";

const LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase?.()] ?? LOG_LEVELS.INFO;

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Colored-dot tags to correlate request lines by session (same session → same color)
const REQ_TAGS = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪", "🟤"];
let tagCursor = 0;

export function nextTag() {
  const tag = REQ_TAGS[tagCursor % REQ_TAGS.length];
  tagCursor++;
  return tag;
}

export function tagForSession(seed) {
  if (!seed) return nextTag();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return REQ_TAGS[Math.abs(h) % REQ_TAGS.length];
}

export function line(tag, symbol, message) {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

export function errorLine(tag, symbol, message) {
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}

export function fmtThink(intent) {
  if (!intent || !intent.mode) return null;
  if (intent.mode === "none") return "off";
  if (intent.mode === "auto") return "auto";
  if (intent.mode === "budget") {
    const k = intent.budget >= 1000 ? `${Math.round(intent.budget / 1000)}k` : `${intent.budget}`;
    return k;
  }
  if (intent.mode === "level") return intent.level;
  return null;
}

function spreadData(data) {
  if (!data) return {};
  if (typeof data === "string") return { detail: data };
  if (typeof data === "object") return data;
  return { detail: String(data) };
}

export function debug(tag, message, data) {
  logger.debug({ tag, ...spreadData(data) }, message);
}

export function info(tag, message, data) {
  logger.info({ tag, ...spreadData(data) }, message);
}

export function warn(tag, message, data) {
  logger.warn({ tag, ...spreadData(data) }, message);
}

export function error(tag, message, data) {
  logger.error({ tag, ...spreadData(data) }, message);
}

export function request(method, path, extra) {
  logger.info({ tag: "REQ", method, path, ...spreadData(extra) }, `${method} ${path}`);
}

export function response(status, duration, extra) {
  const fn = status < 400 ? logger.info.bind(logger) : logger.warn.bind(logger);
  fn({ tag: "RES", status, durationMs: duration, ...spreadData(extra) }, `${status} (${duration}ms)`);
}

export function stream(event, data) {
  logger.debug({ tag: "STREAM", event, ...spreadData(data) }, event);
}

export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
