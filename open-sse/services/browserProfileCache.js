// Cache pruning for shared browser profiles.
//
// A persistent Chrome profile keeps every JS bundle, asset and GPU shader it
// ever fetched. On the profiles used for web-cookie logins that dwarfs the
// data we actually need: `default` grew to 334 MB, of which ~20 MB was
// cookies + Local Storage + IndexedDB and the rest was Cache / Code Cache /
// Service Worker. Pruning after the browser closes reclaims that space without
// touching the session — login survives, only the warm cache is lost.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Directories Chrome can rebuild on its own. Everything holding session state
 * (Cookies, Local Storage, IndexedDB, Login Data, Preferences) is deliberately
 * absent from this list.
 */
const CACHE_DIRS = [
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnWebGPUCache",
  "Default/DawnGraphiteCache",
  "Default/GrShaderCache",
  "Default/ShaderCache",
  "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache",
  "GraphiteDawnCache",
];

function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += directorySize(full);
      else total += statSync(full).size;
    } catch {
      // A file removed mid-walk is fine — the next prune catches it.
    }
  }
  return total;
}

/**
 * Delete the rebuildable caches inside one profile directory.
 * Safe only while the browser is closed; callers prune from their `finally`.
 *
 * @returns {{freedBytes: number, removed: string[]}}
 */
export function pruneProfileCaches(profileDir) {
  const removed = [];
  let freedBytes = 0;
  for (const relative of CACHE_DIRS) {
    const target = join(profileDir, relative);
    if (!existsSync(target)) continue;
    const before = directorySize(target);
    try {
      rmSync(target, { recursive: true, force: true });
      removed.push(relative);
      freedBytes += before;
    } catch {
      // Locked file (antivirus, another Chrome) — leave it for next time.
    }
  }
  return { freedBytes, removed };
}

/** Human-readable size for logs. */
export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
