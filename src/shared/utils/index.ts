// Shared Utils - Export all
export { cn } from "./cn";
export * as api from "./api";

import { v4 as uuidv4 } from "uuid";

/**
 * Generate unique ID (UUID v4)
 */
export const generateId = uuidv4;

/**
 * Extract error code from error message (401, 429, 503...)
 */
export function getErrorCode(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  const match = lastError.match(/\b([45]\d{2})\b/);
  return match ? match[1] : "ERR";
}

/**
 * Get relative time string (e.g. "5 min ago")
 */
export function getRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
