// Logger utility — now backed by Pino via @/lib/logger.
// Kept tag-based API for backward compatibility with existing call sites.

import { logger } from "@/lib/logger";

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

// Mask sensitive data
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
