/**
 * Language server (LS) subprocess lifecycle.
 *
 * Adapted from dwgx/WindsurfAPI's langserver.js, simplified for 9router:
 * we don't multiplex by proxy (one LS per 9router process), we don't need
 * eviction (pool size = 1), and we let 9router itself handle install on
 * first start.
 *
 * Public API:
 *   ensureLs() → { port, csrfToken, ready, generation }
 *   stopLs()
 *   getLs() → entry or null
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ensureLsBinary, lsBinaryPath } from "./ls-install.js";
import { log } from "./config.js";

const DEFAULT_PORT = Number(process.env.LS_DEFAULT_PORT || 42100);
const CSRF_TOKEN = "windsurf-9router-csrf";
const API_SERVER_URL = process.env.LS_API_SERVER_URL || "https://server.self-serve.windsurf.com";
const READY_TIMEOUT_MS = 30_000;
const AUTO_RESTART_BACKOFF_MS = 1500;

let _entry = null;          // { process, port, csrfToken, ready, generation, startedAt }
let _pending = null;        // in-flight ensureLs promise (so concurrent callers share one spawn)
let _intentionalShutdown = false;

function dataDir() {
  return path.join(os.homedir(), ".9router", "ls", "data");
}

function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host });
    let resolved = false;
    const finish = (val) => { if (!resolved) { resolved = true; resolve(val); sock.destroy(); } };
    sock.on("connect", () => finish(true));
    sock.on("error", () => finish(false));
    setTimeout(() => finish(false), 800);
  });
}

async function findFreePort(start) {
  let port = start;
  for (let i = 0; i < 100; i++) {
    if (!(await isPortInUse(port))) return port;
    port++;
  }
  throw new Error(`No free port found starting at ${start}`);
}

async function waitPortReady(port, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortInUse(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`LS port ${port} not ready after ${timeoutMs}ms`);
}

export function getLs() {
  return _entry;
}

export async function ensureLs() {
  if (_entry?.ready) return _entry;
  if (_pending) return _pending;

  _pending = (async () => {
    // Install binary if missing.
    const binaryPath = await ensureLsBinary({ log });
    if (!existsSync(binaryPath)) {
      throw new Error(`LS binary missing at ${binaryPath} after install`);
    }

    const port = await findFreePort(DEFAULT_PORT);
    const dir = dataDir();
    try { mkdirSync(path.join(dir, "db"), { recursive: true }); } catch {}

    const args = [
      `--api_server_url=${API_SERVER_URL}`,
      `--server_port=${port}`,
      `--csrf_token=${CSRF_TOKEN}`,
      `--register_user_url=https://api.codeium.com/register_user/`,
      `--codeium_dir=${dir}`,
      `--database_dir=${path.join(dir, "db")}`,
      "--detect_proxy=false",
    ];

    log.info(`[LS] spawning ${binaryPath} on port ${port}`);
    const proc = spawn(binaryPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      for (const line of text.split("\n")) {
        if (/ERROR|error/.test(line)) log.error?.(`[LS] ${line}`);
        else log.debug?.(`[LS] ${line}`);
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) log.warn?.(`[LS:err] ${text}`);
    });

    proc.on("exit", (code, signal) => {
      log.warn?.(`[LS] exited code=${code} signal=${signal}`);
      const wasReady = _entry?.ready;
      _entry = null;
      if (!_intentionalShutdown && wasReady) {
        // Auto-restart after brief backoff so pending requests don't fail
        // with ECONNRESET.
        setTimeout(() => { ensureLs().catch((e) => log.error?.(`[LS] auto-restart failed: ${e.message}`)); }, AUTO_RESTART_BACKOFF_MS);
      }
      _intentionalShutdown = false;
    });
    proc.on("error", (err) => {
      log.error?.(`[LS] spawn error: ${err.message}`);
      _entry = null;
    });

    const entry = {
      process: proc,
      port,
      csrfToken: CSRF_TOKEN,
      ready: false,
      generation: randomUUID(),
      startedAt: Date.now(),
      // One-shot workspace init (StartCascade etc.) — Cascade mode uses this.
      workspaceInit: null,
      sessionId: null,
    };
    _entry = entry;

    try {
      await waitPortReady(port);
      entry.ready = true;
      log.info(`[LS] ready on port ${port}`);
    } catch (err) {
      log.error?.(`[LS] not ready: ${err.message}`);
      try { proc.kill("SIGKILL"); } catch {}
      _entry = null;
      throw err;
    }
    return entry;
  })();

  try {
    return await _pending;
  } finally {
    _pending = null;
  }
}

export function stopLs() {
  if (!_entry?.process) return;
  _intentionalShutdown = true;
  try { _entry.process.kill("SIGTERM"); } catch {}
  _entry = null;
}

// Best-effort cleanup on process exit so we don't leak LS subprocesses.
process.on("exit", () => { try { stopLs(); } catch {} });
process.on("SIGINT", () => { try { stopLs(); } catch {} });
process.on("SIGTERM", () => { try { stopLs(); } catch {} });
