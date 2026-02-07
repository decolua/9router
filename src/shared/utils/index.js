// Shared Utils - Export all
export { cn } from "./cn";
export * as api from "./api";

import { v4 as uuidv4 } from "uuid";

/**
 * Generate unique ID (UUID v4)
 * @returns {string} UUID v4 string
 */
export const generateId = uuidv4;

/**
 * Extract error code from error message (401, 429, 503...)
 * @param {string} lastError - Error message
 * @returns {string|null} Error code or null
 */
export function getErrorCode(lastError) {
  if (!lastError) return null;
  const match = lastError.match(/\b([45]\d{2})\b/);
  return match ? match[1] : "ERR";
}

/**
 * Get relative time string (e.g. "5 min ago")
 * @param {string} isoDate - ISO date string
 * @returns {string} Relative time
 */
export function getRelativeTime(isoDate, options = {}) {
  if (!isoDate) return "";
  const { locale = "en", messages } = options;
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return messages?.justNow || "just now";
  if (mins < 60) {
    return messages?.minutesAgo ? messages.minutesAgo(mins) : `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return messages?.hoursAgo ? messages.hoursAgo(hours) : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (messages?.daysAgo) return messages.daysAgo(days);
  return `${days}d ago`;
}

