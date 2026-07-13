/**
 * Inline stdio ↔ SSE bridge for preset MCP plugins.
 *
 * One child process is spawned per plugin on demand. Newline-delimited
 * JSON-RPC frames from the child's stdout are filtered (see `smartFilterText`)
 * and fanned out over all registered SSE sessions. Client messages arrive via
 * HTTP POST and are written to the child's stdin. Idle children are killed
 * after `IDLE_TIMEOUT_MS`.
 *
 * Only plugins registered in the preset plugin registry may spawn — this is a
 * hard RCE guard against user-supplied commands.
 */

import { spawn } from "child_process";
import crypto from "crypto";
import { findPlugin as findPluginInRegistry } from "./plugins.js";
import {
  ensureCodeGraphInitialized,
  isCodeGraphServer,
  resolveLocalStdioSpawn,
} from "./security.js";

// ─── Constants ─────────────────────────────────────────────────────────────

const G_KEY = "__9routerMcpBridges";
const MAX_TEXT_CHARS = 50_000;
const COLLAPSE_THRESHOLD = 30;
const COLLAPSE_KEEP_HEAD = 10;
const COLLAPSE_KEEP_TAIL = 5;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const KILL_GRACE_MS = 5_000;

// ─── Text filtering ────────────────────────────────────────────────────────

/**
 * Drop noise nodes, collapse repeated siblings, hard-truncate.
 * Preserves `[ref=eXX]` markers so downstream tooling can still click.
 */
function smartFilterText(text) {
  if (typeof text !== "string" || text.length < 2000) return text;
  let out = text;
  out = out.replace(/^\s*-\s*generic:?\s*$/gm, "");
  out = out.replace(/^\s*-\s*text:\s*""\s*$/gm, "");
  out = collapseRepeated(out);
  if (out.length > MAX_TEXT_CHARS) {
    const head = out.slice(0, MAX_TEXT_CHARS - 300);
    out = `${head}\n\n... [truncated ${text.length - head.length} chars by 9router bridge. Page is large; ask user to scroll/navigate to a specific section, or click an element with the refs shown above]`;
  }
  return out;
}

/**
 * Group consecutive lines sharing the same leading indent + role prefix;
 * collapse the middle when at least `COLLAPSE_THRESHOLD` siblings appear.
 */
function collapseRepeated(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (!match) {
      out.push(line);
      i++;
      continue;
    }

    const indent = match[1];
    const role = match[2];
    let j = i;
    while (j < lines.length) {
      const ln = lines[j];
      const mm = ln.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
      if (mm && mm[1] === indent && mm[2] === role) {
        j++;
        continue;
      }
      if (ln.startsWith(`${indent} `) || ln.startsWith(`${indent}\t`)) {
        j++;
        continue;
      }
      break;
    }

    const groupLen = j - i;
    if (groupLen >= COLLAPSE_THRESHOLD) {
      const headEnd = findNthSiblingEnd(
        lines,
        i,
        indent,
        role,
        COLLAPSE_KEEP_HEAD,
      );
      const tailStart = findLastNSiblingStart(
        lines,
        j,
        indent,
        role,
        COLLAPSE_KEEP_TAIL,
      );
      for (let k = i; k < headEnd; k++) out.push(lines[k]);
      out.push(
        `${indent}... [${groupLen - COLLAPSE_KEEP_HEAD - COLLAPSE_KEEP_TAIL} similar "${role}" items omitted by 9router bridge]`,
      );
      for (let k = tailStart; k < j; k++) out.push(lines[k]);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out.join("\n");
}

function findNthSiblingEnd(lines, start, indent, role, n) {
  let count = 0;
  for (let k = start; k < lines.length; k++) {
    const mm = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) {
      count++;
      if (count > n) return k;
    }
  }
  return lines.length;
}

function findLastNSiblingStart(lines, end, indent, role, n) {
  const positions = [];
  for (let k = 0; k < end; k++) {
    const mm = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) positions.push(k);
  }
  return positions.length > n ? positions[positions.length - n] : end;
}

/** Apply the text filter to any `text` blocks inside a tools/call result. */
function filterFrame(line) {
  try {
    const msg = JSON.parse(line);
    const content = msg?.result?.content;
    if (!Array.isArray(content)) return line;
    let mutated = false;
    for (const item of content) {
      if (item?.type === "text" && typeof item.text === "string") {
        const filtered = smartFilterText(item.text);
        if (filtered !== item.text) {
          item.text = filtered;
          mutated = true;
        }
      }
    }
    return mutated ? JSON.stringify(msg) : line;
  } catch {
    return line;
  }
}

// ─── Process store ─────────────────────────────────────────────────────────

function getStore() {
  if (!globalThis[G_KEY]) globalThis[G_KEY] = new Map();
  return globalThis[G_KEY];
}

/** Look up a preset plugin. Only registered plugins may spawn. */
export function findPlugin(name) {
  return findPluginInRegistry(name) || null;
}

// ─── Idle timeout ──────────────────────────────────────────────────────────

function startIdleTimer(name, entry) {
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    if (entry.sessions.size === 0) {
      console.log(`[mcp:${name}] idle timeout, killing process`);
      killEntry(entry);
    } else {
      console.log(
        `[mcp:${name}] idle timeout but has ${entry.sessions.size} active session(s), skipping`,
      );
    }
  }, IDLE_TIMEOUT_MS);
}

function resetIdleTimer(name, entry) {
  if (entry.idleTimer) startIdleTimer(name, entry);
}

function clearIdleTimer(entry) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function killEntry(entry) {
  clearIdleTimer(entry);
  if (entry.proc && !entry.proc.killed && entry.proc.exitCode === null) {
    try {
      entry.proc.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      if (entry.proc && !entry.proc.killed && entry.proc.exitCode === null) {
        try {
          entry.proc.kill("SIGKILL");
        } catch {}
      }
    }, KILL_GRACE_MS);
  }
}

function cleanupEntry(name, entry) {
  clearIdleTimer(entry);
  const store = getStore();
  if (store.get(name) === entry) store.delete(name);
}

// ─── Spawn / lifecycle ─────────────────────────────────────────────────────

export function getOrSpawn(name) {
  const store = getStore();
  let entry = store.get(name);
  if (entry?.proc && !entry.proc.killed && entry.proc.exitCode === null) {
    resetIdleTimer(name, entry);
    return entry;
  }

  // Clear any stale entry.
  if (entry) {
    clearIdleTimer(entry);
    store.delete(name);
  }

  const plugin = findPlugin(name);
  if (!plugin) throw new Error(`Unknown local plugin: ${name}`);

  if (isCodeGraphServer(plugin)) {
    ensureCodeGraphInitialized();
  }

  const startTime = Date.now();
  const spawnConfig = resolveLocalStdioSpawn(plugin.command, plugin.args || []);
  const proc = spawn(spawnConfig.command, spawnConfig.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  entry = { proc, sessions: new Map(), buffer: "", startTime, idleTimer: null };
  store.set(name, entry);

  // Parse newline-delimited JSON-RPC from child stdout, broadcast to sessions.
  proc.stdout.on("data", (chunk) => {
    entry.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = entry.buffer.indexOf("\n")) >= 0) {
      const raw = entry.buffer.slice(0, idx).trim();
      entry.buffer = entry.buffer.slice(idx + 1);
      if (!raw) continue;
      const line = filterFrame(raw);
      for (const send of entry.sessions.values()) {
        try {
          send(`event: message\ndata: ${line}\n\n`);
        } catch {
          /* broken pipe */
        }
      }
    }
    resetIdleTimer(name, entry);
  });

  proc.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (!msg) return;
    console.log(`[mcp:${name}] stderr:`, msg);
    for (const send of entry.sessions.values()) {
      try {
        send(
          `event: stderr\ndata: ${JSON.stringify({ plugin: name, message: msg })}\n\n`,
        );
      } catch {}
    }
  });

  proc.on("error", (err) => {
    console.error(`[mcp:${name}] process error:`, err.message);
    cleanupEntry(name, entry);
  });

  proc.on("exit", (code, signal) => {
    const runtime = Date.now() - startTime;
    console.log(
      `[mcp:${name}] exited code=${code} signal=${signal} runtime=${runtime}ms`,
    );
    cleanupEntry(name, entry);
    for (const send of entry.sessions.values()) {
      try {
        send(
          `event: process_exit\ndata: ${JSON.stringify({ plugin: name, code, signal })}\n\n`,
        );
      } catch {}
    }
  });

  console.log(
    `[mcp:${name}] spawned (command: ${plugin.command} ${(plugin.args || []).join(" ")})`,
  );
  startIdleTimer(name, entry);
  return entry;
}

// ─── Session management ────────────────────────────────────────────────────

export function registerSession(name, sendFn) {
  const entry = getOrSpawn(name);
  const sid = crypto.randomUUID();
  entry.sessions.set(sid, sendFn);
  console.log(
    `[mcp:${name}] session registered: ${sid} (total: ${entry.sessions.size})`,
  );
  return sid;
}

export function unregisterSession(name, sid) {
  const entry = getStore().get(name);
  if (!entry) return;
  entry.sessions.delete(sid);
  console.log(
    `[mcp:${name}] session unregistered: ${sid} (total: ${entry.sessions.size})`,
  );
  if (
    entry.sessions.size === 0 &&
    entry.proc &&
    !entry.proc.killed &&
    entry.proc.exitCode === null
  ) {
    console.log(`[mcp:${name}] no active sessions, starting idle timer`);
    startIdleTimer(name, entry);
  }
}

/** Write a JSON-RPC message to the plugin's stdin. */
export function sendToChild(name, jsonRpc) {
  const entry = getStore().get(name);
  if (!entry?.proc?.stdin?.writable) {
    throw new Error(`Bridge not running: ${name}`);
  }
  entry.proc.stdin.write(`${JSON.stringify(jsonRpc)}\n`);
}

export function isRunning(name) {
  const entry = getStore().get(name);
  return !!(entry?.proc && !entry.proc.killed && entry.proc.exitCode === null);
}

/** Kill all spawned MCP children — called on app shutdown to prevent orphans. */
export function killAllBridges() {
  const store = getStore();
  for (const [name, entry] of store) {
    try { entry.proc?.kill(); } catch { /* best effort */ }
    store.delete(name);
  }
}

/** Snapshot of every running bridge child. Used by the status endpoint. */
export function getStatus() {
  const store = getStore();
  const status = {};
  for (const [name, entry] of store.entries()) {
    status[name] = {
      running: !!(
        entry.proc &&
        !entry.proc.killed &&
        entry.proc.exitCode === null
      ),
      sessions: entry.sessions.size,
      uptime: entry.startTime ? Date.now() - entry.startTime : 0,
    };
  }
  return status;
}
