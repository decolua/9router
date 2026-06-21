// Stdio upstream MCP client for the gateway.
//
// One long-lived child process per `instance.id`, keyed in globalThis so
// dev hot-reload doesn't multiply processes. Newline-delimited JSON-RPC
// on stdin/stdout, request/response matched by `id`.
//
// Threat model: the gateway is operator-configured (not harness-configured),
// so arbitrary command+args are allowed — see plan §P0.4. This differs from
// stdioSseBridge.js's preset-only RCE guard deliberately.
//
// Operations exposed: listTools, callTool. The child is auto-respawned on
// exit and on spawn-failure; pending requests are rejected with a clear
// error so the gateway can surface the failure to the harness.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const STDIO_KEY = "__9routerGatewayStdio";
const STDIO_PROTOCOL_VERSION = "2025-06-18";
const STDIO_TIMEOUT_MS = 60_000;
const STDIO_INIT_TIMEOUT_MS = 10_000;

function getStore() {
  if (!globalThis[STDIO_KEY]) globalThis[STDIO_KEY] = new Map();
  return globalThis[STDIO_KEY];
}

function parseArgs(args) {
  if (Array.isArray(args)) return args;
  if (typeof args === "string") {
    if (!args.trim()) return [];
    try { const v = JSON.parse(args); return Array.isArray(v) ? v : []; }
    catch { return args.split(/\s+/).filter(Boolean); }
  }
  return [];
}

function parseEnv(env) {
  if (!env) return {};
  if (typeof env === "string") {
    try { const v = JSON.parse(env); return v && typeof v === "object" ? v : {}; }
    catch { return {}; }
  }
  if (typeof env === "object") return env;
  return {};
}

class StdioEntry {
  constructor(instance) {
    this.instance = instance;
    this.proc = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.events = new EventEmitter();
    this.initializing = null;
    this.initialized = false;
    this.initPromise = null;
    this.initInfo = null;
  }

  isAlive() {
    return this.proc && !this.proc.killed && this.proc.exitCode === null;
  }

  async ensure() {
    if (this.isAlive()) return;
    this.spawn();
    await this.initializing;
  }

  spawn() {
    const { command, args, env } = this.instance;
    if (!command) {
      this.initializing = Promise.reject(new Error(`instance ${this.instance.slug} has no command`));
      this.initializing.catch(() => {});
      throw this.initializing;
    }
    const argv = parseArgs(args);
    const extraEnv = parseEnv(env);
    let proc;
    try {
      proc = spawn(command, argv, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...extraEnv },
      });
    } catch (e) {
      const err = new Error(`failed to spawn ${command}: ${e.message}`);
      this.initializing = Promise.reject(err);
      this.initializing.catch(() => {});
      throw err;
    }
    this.proc = proc;
    this.buffer = "";
    this.pending.clear();
    this.initialized = false;
    this.initPromise = null;
    this.initInfo = null;

    const ready = new Promise((resolve, reject) => {
      const onError = (e) => reject(new Error(`${command} spawn error: ${e.message}`));
      proc.once("error", onError);
      // Resolve early; initialize() does the real handshake. We just want
      // the child to be writable. If it dies before initialize, the
      // exit handler below rejects pending requests.
      setImmediate(() => {
        proc.removeListener("error", onError);
        resolve();
      });
    });
    this.initializing = ready;

    proc.stdout.on("data", (chunk) => this.onData(chunk));
    proc.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (line) console.log(`[mcp-gw:${this.instance.slug}]`, line);
    });
    proc.on("exit", (code, signal) => {
      this.proc = null;
      const err = new Error(`upstream ${this.instance.slug} exited (code=${code}, signal=${signal})`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(err);
      }
      this.pending.clear();
      this.events.emit("exit");
    });
    proc.on("error", (e) => {
      const err = new Error(`upstream ${this.instance.slug} error: ${e.message}`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(err);
      }
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const raw = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!raw) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (parsed && parsed.id !== undefined && this.pending.has(parsed.id)) {
        const { resolve, timer } = this.pending.get(parsed.id);
        clearTimeout(timer);
        this.pending.delete(parsed.id);
        resolve(parsed);
      }
    }
  }

  request(method, params, { timeoutMs = STDIO_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isAlive()) {
        return reject(new Error(`upstream ${this.instance.slug} not running`));
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`upstream ${this.instance.slug} request ${method} timed out`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} })}\n`);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`write to ${this.instance.slug} failed: ${e.message}`));
      }
    });
  }

  async ensureInitialized() {
    if (this.initialized) return this.initInfo;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const init = await this.request("initialize", {
          protocolVersion: STDIO_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "9router-gateway", version: "1" },
        }, { timeoutMs: STDIO_INIT_TIMEOUT_MS });
        if (init.error) {
          throw new Error(`initialize failed: ${init.error.message || JSON.stringify(init.error)}`);
        }
        // notifications/initialized — best-effort, fire-and-forget.
        try {
          this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
        } catch { /* ignore */ }
        this.initInfo = {
          protocolVersion: init.result?.protocolVersion || STDIO_PROTOCOL_VERSION,
          serverInfo: init.result?.serverInfo || null,
        };
        this.initialized = true;
        return this.initInfo;
      } catch (e) {
        this.initialized = false;
        this.initPromise = null;
        this.initInfo = null;
        getStore().delete(this.instance.id);
        throw e;
      }
    })();

    return this.initPromise;
  }
}

function getEntry(instance) {
  const store = getStore();
  let entry = store.get(instance.id);
  if (!entry) {
    entry = new StdioEntry(instance);
    store.set(instance.id, entry);
  }
  return entry;
}

export async function listTools(instance) {
  const entry = getEntry(instance);
  await entry.ensure();
  await entry.ensureInitialized();
  const resp = await entry.request("tools/list", {});
  if (resp.error) {
    throw new Error(`tools/list failed: ${resp.error.message || JSON.stringify(resp.error)}`);
  }
  return resp.result?.tools || [];
}

export async function callTool(instance, name, args) {
  const entry = getEntry(instance);
  await entry.ensure();
  await entry.ensureInitialized();
  const resp = await entry.request("tools/call", { name, arguments: args || {} });
  if (resp.error) {
    const e = new Error(resp.error.message || `tools/call failed`);
    e.code = resp.error.code;
    e.data = resp.error.data;
    throw e;
  }
  return resp.result;
}

export const __test__ = { StdioEntry, getStore, getEntry };
