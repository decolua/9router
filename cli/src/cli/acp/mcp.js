/**
 * Stdio MCP client.
 *
 * Zed (and other ACP clients) forward their configured MCP servers in
 * `session/new.mcpServers`; ACP requires agents to support the stdio
 * transport, so we spawn them and surface their tools in the agent loop as
 * `mcp__<server>__<tool>`.
 *
 * Wire format is newline-delimited JSON-RPC 2.0 (MCP stdio transport).
 * Nothing from `env` is ever logged — those values are credentials.
 */

const { spawn } = require("child_process");

const INIT_TIMEOUT_MS = 10000;
const CALL_TIMEOUT_MS = 60000;
const SAFE_PREFIX = /^(read|list|get|search|fetch|query|lookup|describe|check)/;

class McpClient {
  constructor({ name, command, args = [], env = {}, cwd, log = () => {} }) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.log = log;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
    this.buffer = "";
    this.notifications = [];
  }

  start() {
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd || process.cwd(),
      env: { ...process.env, ...(this.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => this.log(`[mcp:${this.name}] ${String(chunk).slice(0, 500)}`));
    this.proc.on("error", (err) => this._failAll(err));
    this.proc.on("close", () => this._failAll(new Error(`MCP server "${this.name}" exited`)));
  }

  _failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
        else p.resolve(msg.result);
      } else if (msg.method) {
        // Server-initiated requests are not needed by the agent loop: answer
        // method-not-found rather than hanging the child.
        if (msg.id !== undefined) this._send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not supported by 9router" } });
        else this.notifications.push(msg);
      }
    }
  }

  _send(msg) {
    if (!this.proc || this.proc.stdin.destroyed) throw new Error(`MCP server "${this.name}" is not running`);
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  request(method, params, timeoutMs = INIT_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out on "${this.name}"`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params) {
    try {
      this._send({ jsonrpc: "2.0", method, params });
    } catch {
      /* best-effort */
    }
  }

  async initialize() {
    this.start();
    const res = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "9router-acp", version: require("../../../package.json").version },
    });
    this.notify("notifications/initialized", {});
    const list = await this.request("tools/list", {}, 10000);
    this.tools = Array.isArray(list?.tools) ? list.tools : [];
    this.serverInfo = res?.serverInfo?.name || this.name;
    return this.tools;
  }

  async callTool(name, args, { signal } = {}) {
    const res = await Promise.race([
      this.request("tools/call", { name, arguments: args || {} }, CALL_TIMEOUT_MS),
      signal ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })) : new Promise(() => {}),
    ]);
    const parts = [];
    for (const block of res?.content || []) {
      if (block?.type === "text") parts.push(block.text);
      else if (block?.type === "image") parts.push(`[image ${block.mimeType || ""}]`);
      else if (block?.type === "resource") parts.push(block.resource?.text || `[resource ${block.resource?.uri || ""}]`);
      else parts.push(JSON.stringify(block));
    }
    if (res?.isError) throw new Error(parts.join("\n").slice(0, 4000) || "MCP tool failed");
    return parts.join("\n").slice(0, 20000);
  }

  stop() {
    try {
      this.proc?.stdin.end();
    } catch {
      /* ignore */
    }
    const proc = this.proc;
    if (!proc) return;
    const t = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000);
    proc.once("close", () => clearTimeout(t));
  }
}

/** Spawn every stdio server from `session/new` and build extra tool defs. */
async function startMcpServers(servers, { cwd, log = () => {} } = {}) {
  const clients = [];
  const extraTools = [];
  for (const s of servers || []) {
    if (!s?.command) continue;
    const client = new McpClient({ name: s.name || "mcp", command: s.command, args: s.args || [], env: s.env || {}, cwd, log });
    try {
      await client.initialize();
      clients.push(client);
      for (const t of client.tools) {
        const full = `mcp__${client.name}__${t.name}`;
        const safe = SAFE_PREFIX.test(String(t.name)) || t.annotations?.readOnlyHint === true;
        extraTools.push({
          name: full,
          kind: safe ? "read" : "other",
          // Conservative: anything that is not obviously read-only is approved
          // through the editor's permission prompt.
          needsPermission: !safe,
          description: String(t.description || `MCP tool ${t.name} from ${client.name}`).slice(0, 1000),
          parameters: t.inputSchema || { type: "object", properties: {} },
          async run({ args, ctx }) {
            const text = await client.callTool(t.name, args, { signal: ctx.signal });
            return { text };
          },
        });
      }
    } catch (err) {
      log(`[mcp:${client.name}] failed to start: ${err.message}`);
      client.stop();
    }
  }
  return { clients, extraTools };
}

function stopMcpServers(clients = []) {
  for (const c of clients) c.stop();
}

module.exports = { McpClient, startMcpServers, stopMcpServers };
